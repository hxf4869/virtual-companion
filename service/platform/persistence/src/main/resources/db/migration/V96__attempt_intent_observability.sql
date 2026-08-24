-- S0-24-B2 V96: durable per-provider-attempt latency and normalized failure telemetry.
--
-- attempt_intent remains the authoritative outbound fence. The start timestamp
-- is written by the same short transaction that creates the intent, before any
-- provider I/O. First-output latency is measured in memory with a monotonic JVM
-- clock and persisted only after execute returns; no database access is added to
-- the external streaming callback. Terminal timestamps use the database clock.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.attempt_intent
    ADD COLUMN attempt_started_at timestamptz,
    ADD COLUMN first_output_latency_ms bigint,
    ADD COLUMN terminal_at timestamptz,
    ADD COLUMN failure_code text;

-- Existing rows predate these fields. created_at is the closest durable start
-- fence, and historical provider failures have no safe finer classification.
UPDATE vc.attempt_intent
   SET attempt_started_at = created_at,
       terminal_at = CASE WHEN status = 'CREATED' THEN NULL ELSE created_at END,
       failure_code = CASE
           WHEN status IN ('RETRYABLE_FAILED', 'NON_RETRYABLE_FAILED', 'TIMED_OUT')
               THEN 'OTHER'
           ELSE NULL
       END;

ALTER TABLE vc.attempt_intent
    ALTER COLUMN attempt_started_at SET NOT NULL,
    ALTER COLUMN attempt_started_at SET DEFAULT clock_timestamp(),
    ADD CONSTRAINT attempt_intent_first_output_latency_check CHECK (
        first_output_latency_ms IS NULL OR first_output_latency_ms >= 0),
    ADD CONSTRAINT attempt_intent_terminal_telemetry_check CHECK (
        (status = 'CREATED'
            AND terminal_at IS NULL
            AND first_output_latency_ms IS NULL
            AND failure_code IS NULL)
        OR
        (status <> 'CREATED'
            AND terminal_at IS NOT NULL
            AND terminal_at >= attempt_started_at)),
    ADD CONSTRAINT attempt_intent_failure_code_check CHECK (
        (status IN ('RETRYABLE_FAILED', 'NON_RETRYABLE_FAILED', 'TIMED_OUT')
            AND failure_code IS NOT NULL
            AND failure_code IN (
                'HTTP_429', 'HTTP_5XX', 'DISCONNECTED',
                'TIMEOUT_CONNECT', 'TIMEOUT_FIRST_TOKEN', 'TIMEOUT_TOTAL', 'OTHER'))
        OR
        (status IN ('CREATED', 'SUCCEEDED', 'CANCELLED', 'ABANDONED_LATE')
            AND failure_code IS NULL));

-- Replaces V28 only to make the database-clock start fence explicit.
CREATE OR REPLACE FUNCTION vc.create_attempt_intent(
    p_owner_user_id                    bigint,
    p_work_item_id                     bigint,
    p_generation_id                    bigint,
    p_claim_token_hash                 text,
    p_claim_fence_hash                 text,
    p_provider_attempt_id              text,
    p_provider_id                      text,
    p_supplier_name                    text,
    p_requested_authorization_snapshot text,
    p_execution_authorization_snapshot text)
    RETURNS TABLE(out_id bigint, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_work_item_id IS NULL THEN
        RAISE EXCEPTION 'create_attempt_intent: work_item_id is required';
    END IF;
    IF p_generation_id IS NULL THEN
        RAISE EXCEPTION 'create_attempt_intent: generation_id is required';
    END IF;
    IF p_claim_token_hash IS NULL OR btrim(p_claim_token_hash) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: claim_token_hash is required';
    END IF;
    IF p_claim_fence_hash IS NULL OR btrim(p_claim_fence_hash) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: claim_fence_hash is required';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: provider_attempt_id is required';
    END IF;
    IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: provider_id is required';
    END IF;
    IF p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: supplier_name is required';
    END IF;
    IF p_requested_authorization_snapshot IS NULL OR btrim(p_requested_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: requested_authorization_snapshot is required';
    END IF;
    IF p_execution_authorization_snapshot IS NULL OR btrim(p_execution_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: execution_authorization_snapshot is required';
    END IF;

    PERFORM 1 FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.id = p_work_item_id
       AND wi.status = 'CLAIMED'
       AND encode(digest(wi.claim_token, 'sha256'), 'hex') = p_claim_token_hash
       AND encode(digest(wi.claim_fence, 'sha256'), 'hex') = p_claim_fence_hash
       AND wi.lease_expires_at > clock_timestamp();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_attempt_intent: work item % has no live claim matching the presented token/fence (missing, overtaken or lease expired)',
            p_work_item_id;
    END IF;

    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_attempt_intent: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    v_id := nextval('vc.attempt_intent_id_seq');
    INSERT INTO vc.attempt_intent(
        owner_user_id, id, work_item_id, generation_id, provider_attempt_id,
        provider_id, supplier_name, status,
        claim_token_hash, claim_fence_hash,
        requested_authorization_snapshot, execution_authorization_snapshot,
        attempt_started_at)
    VALUES (
        p_owner_user_id, v_id, p_work_item_id, p_generation_id, p_provider_attempt_id,
        p_provider_id, p_supplier_name, 'CREATED',
        p_claim_token_hash, p_claim_fence_hash,
        p_requested_authorization_snapshot, p_execution_authorization_snapshot,
        clock_timestamp());

    RETURN QUERY SELECT v_id, p_provider_attempt_id;
END;
$$;

-- Telemetry-aware outcome writer. The CREATED predicate is the write-once
-- guard: terminal outcome, latency and failure code are committed together.
CREATE OR REPLACE FUNCTION vc.record_attempt_outcome(
    p_owner_user_id        bigint,
    p_provider_attempt_id  text,
    p_status               text,
    p_first_output_latency_ms bigint,
    p_failure_code         text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'record_attempt_outcome: provider_attempt_id is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'SUCCEEDED','RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT','CANCELLED'
    ) THEN
        RAISE EXCEPTION 'record_attempt_outcome: unsupported outcome status %', p_status;
    END IF;
    IF p_first_output_latency_ms IS NOT NULL AND p_first_output_latency_ms < 0 THEN
        RAISE EXCEPTION 'record_attempt_outcome: first_output_latency_ms must be non-negative';
    END IF;
    IF p_status IN ('RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT') THEN
        IF p_failure_code IS NULL OR p_failure_code NOT IN (
            'HTTP_429', 'HTTP_5XX', 'DISCONNECTED',
            'TIMEOUT_CONNECT', 'TIMEOUT_FIRST_TOKEN', 'TIMEOUT_TOTAL', 'OTHER') THEN
            RAISE EXCEPTION 'record_attempt_outcome: failure status requires a normalized failure_code';
        END IF;
    ELSIF p_failure_code IS NOT NULL THEN
        RAISE EXCEPTION 'record_attempt_outcome: successful or cancelled status forbids failure_code';
    END IF;

    UPDATE vc.attempt_intent
       SET status = p_status,
           first_output_latency_ms = p_first_output_latency_ms,
           terminal_at = clock_timestamp(),
           failure_code = p_failure_code
     WHERE owner_user_id = p_owner_user_id
       AND provider_attempt_id = p_provider_attempt_id
       AND status = 'CREATED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Compatibility wrapper for existing callers. Historical callers cannot
-- classify failures, so failure terminals are conservatively normalized OTHER.
CREATE OR REPLACE FUNCTION vc.record_attempt_outcome(
    p_owner_user_id       bigint,
    p_provider_attempt_id text,
    p_status              text)
    RETURNS integer
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.record_attempt_outcome(
        p_owner_user_id,
        p_provider_attempt_id,
        p_status,
        NULL::bigint,
        CASE WHEN p_status IN ('RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT')
             THEN 'OTHER'::text ELSE NULL::text END)
$$;

CREATE OR REPLACE FUNCTION vc.abandon_late_attempt(
    p_owner_user_id       bigint,
    p_provider_attempt_id text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'abandon_late_attempt: provider_attempt_id is required';
    END IF;

    UPDATE vc.attempt_intent
       SET status = 'ABANDONED_LATE', terminal_at = clock_timestamp()
     WHERE owner_user_id = p_owner_user_id
       AND provider_attempt_id = p_provider_attempt_id
       AND status = 'CREATED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.recover_expired_claims(p_lease_grace_seconds integer DEFAULT 0)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows   integer;
    v_rows2  integer;
    v_cutoff timestamptz := clock_timestamp() - make_interval(secs => GREATEST(p_lease_grace_seconds, 0));
BEGIN
    UPDATE vc.work_item u
       SET status = 'FAILED', finished_at = clock_timestamp()
     WHERE u.status = 'CLAIMED'
       AND u.lease_expires_at <= v_cutoff
       AND EXISTS (
           SELECT 1 FROM vc.attempt_intent ai
            WHERE ai.owner_user_id = u.owner_user_id
              AND ai.work_item_id = u.id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    UPDATE vc.attempt_intent ai
       SET status = 'ABANDONED_LATE', terminal_at = clock_timestamp()
      FROM vc.work_item wi
     WHERE wi.status = 'FAILED'
       AND wi.finished_at IS NOT NULL
       AND ai.owner_user_id = wi.owner_user_id
       AND ai.work_item_id = wi.id
       AND ai.status = 'CREATED';

    UPDATE vc.work_item u
       SET status = 'PENDING',
           claim_token = NULL,
           claim_fence = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
     WHERE u.status = 'CLAIMED'
       AND u.lease_expires_at <= v_cutoff
       AND NOT EXISTS (
           SELECT 1 FROM vc.attempt_intent ai
            WHERE ai.owner_user_id = u.owner_user_id
              AND ai.work_item_id = u.id);
    GET DIAGNOSTICS v_rows2 = ROW_COUNT;
    RETURN v_rows + v_rows2;
END;
$$;

CREATE OR REPLACE FUNCTION vc.close_stale_attempt_intents(
    p_owner_user_id bigint,
    p_work_item_id  bigint)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_closed integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_work_item_id IS NULL THEN
        RAISE EXCEPTION 'close_stale_attempt_intents: owner_user_id and work_item_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'close_stale_attempt_intents: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.attempt_intent
       SET status = 'ABANDONED_LATE', terminal_at = clock_timestamp()
     WHERE owner_user_id = p_owner_user_id
       AND work_item_id = p_work_item_id
       AND status = 'CREATED';
    GET DIAGNOSTICS v_closed = ROW_COUNT;
    RETURN v_closed;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text),
    vc.record_attempt_outcome(bigint, text, text),
    vc.record_attempt_outcome(bigint, text, text, bigint, text),
    vc.abandon_late_attempt(bigint, text),
    vc.recover_expired_claims(integer),
    vc.close_stale_attempt_intents(bigint, bigint)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text),
    vc.record_attempt_outcome(bigint, text, text),
    vc.record_attempt_outcome(bigint, text, text, bigint, text),
    vc.abandon_late_attempt(bigint, text)
    TO vc_worker, vc_api;

-- Preserve the V24/V33 coordinator-only surfaces without widening them.
GRANT EXECUTE ON FUNCTION
    vc.recover_expired_claims(integer),
    vc.close_stale_attempt_intents(bigint, bigint)
    TO vc_api;

DO $$
BEGIN
    IF has_function_privilege('public',
        'vc.record_attempt_outcome(bigint,text,text,bigint,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V96: telemetry outcome writer must not be PUBLIC-executable';
    END IF;
    IF NOT has_function_privilege('vc_api',
        'vc.record_attempt_outcome(bigint,text,text,bigint,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V96: vc_api must execute telemetry outcome writer';
    END IF;
END;
$$;
