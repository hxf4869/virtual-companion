-- TASK-0090 V15: provider_attempt audit table, generation terminal transitions,
-- candidate insertion and quota RELEASE ledger writes.
--
-- Adds one composite-owned FORCE-RLS table (provider_attempt) and four
-- SECURITY DEFINER functions:
--   record_provider_attempt      -- audit one real outbound provider attempt
--   terminalize_generation       -- FAILED_FINAL / OUTPUT_BLOCKED /
--                                    COMPLETED_FALLBACK atomically with the
--                                    terminal realtime_event (INV-TX-001)
--   insert_generation_candidate  -- finalize prerequisite (gap #14)
--   record_quota_release         -- RELEASE ledger row on degraded/failed paths
--
-- All follow the V6/V7/V8 pattern: SET search_path = vc, public,
-- set_config('vc.owner_user_id', ...) to bind FORCE RLS, REVOKE EXECUTE FROM
-- PUBLIC, GRANT EXECUTE TO vc_api only. The audit table deliberately carries
-- no credentials, request body or response text (TASK-0035 audit boundary).
-- CANCELLED keeps the V10 double-hop (CANCEL_REQUESTED -> CANCELLED) via
-- vc.cancel_generation; terminalize_generation never accepts CANCELLED.

-- 1. provider_attempt audit table (status CHECK aligned with the catalog
--    ProviderAttemptStatus enum: CREATED, CONNECTING, STREAMING, EOS_RECEIVED,
--    SUCCEEDED, RETRYABLE_FAILED, NON_RETRYABLE_FAILED, TIMED_OUT,
--    CANCEL_REQUESTED, CANCELLED, ABANDONED_LATE).
CREATE SEQUENCE IF NOT EXISTS vc.provider_attempt_id_seq;

CREATE TABLE IF NOT EXISTS vc.provider_attempt (
    owner_user_id   bigint NOT NULL,
    id              bigint NOT NULL,
    generation_id   bigint NOT NULL,
    provider_id     text   NOT NULL,
    supplier_name   text   NOT NULL,
    status          text   NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT provider_attempt_status_check CHECK (
        status IN ('CREATED','CONNECTING','STREAMING','EOS_RECEIVED','SUCCEEDED',
                   'RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT',
                   'CANCEL_REQUESTED','CANCELLED','ABANDONED_LATE'))
);

-- FORCE ROW LEVEL SECURITY + owner_isolation, matching the V2/V7 baseline.
-- A missing tenant context matches nothing (fail closed).
ALTER TABLE vc.provider_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.provider_attempt FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.provider_attempt;
CREATE POLICY owner_isolation ON vc.provider_attempt FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

GRANT USAGE, SELECT ON SEQUENCE vc.provider_attempt_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT SELECT, INSERT, UPDATE
    ON vc.provider_attempt
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- 2. record_provider_attempt: persist one ProviderAttemptAudit row
--    (providerAttemptId / ownership / providerId / supplierName / status).
CREATE OR REPLACE FUNCTION vc.record_provider_attempt(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_provider_id    text,
    p_supplier_name  text,
    p_status         text
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'record_provider_attempt: owner_user_id and generation_id are required';
    END IF;
    IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: provider_id is required';
    END IF;
    IF p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: supplier_name is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'CREATED','CONNECTING','STREAMING','EOS_RECEIVED','SUCCEEDED',
        'RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT',
        'CANCEL_REQUESTED','CANCELLED','ABANDONED_LATE'
    ) THEN
        RAISE EXCEPTION 'record_provider_attempt: unsupported status %', p_status;
    END IF;
    -- Bind tenant context so the FORCE RLS WITH CHECK predicate passes for the
    -- definer and reads in the same transaction stay owner-scoped.
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- The generation must exist for this owner (existence hidden otherwise).
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_provider_attempt: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    v_id := nextval('vc.provider_attempt_id_seq');
    INSERT INTO vc.provider_attempt(
        owner_user_id, id, generation_id, provider_id, supplier_name, status)
    VALUES (
        p_owner_user_id, v_id, p_generation_id,
        p_provider_id, p_supplier_name, p_status);

    RETURN QUERY SELECT v_id, p_owner_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.record_provider_attempt(bigint, bigint, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.record_provider_attempt(bigint, bigint, text, text, text)
    TO vc_api;

-- 3. terminalize_generation: atomically move a non-terminal generation to a
--    catalog-legal terminal state and write the matching terminal
--    realtime_event in the SAME transaction (INV-TX-001). A terminal
--    generation never accepts append_realtime_event, so the terminal event
--    must land here. The event type must match the terminal state so a caller
--    can never fabricate chat.completed on a failed generation (INV-GEN-003).
--    CANCELLED is deliberately rejected: the catalog double-hop
--    (CANCEL_REQUESTED -> CANCELLED) is served by vc.cancel_generation (V10).
CREATE OR REPLACE FUNCTION vc.terminalize_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_to_status      text,
    p_event_type     text,
    p_payload        jsonb DEFAULT '{}'::jsonb
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'terminalize_generation: owner_user_id and generation_id are required';
    END IF;
    IF p_to_status NOT IN ('FAILED_FINAL','OUTPUT_BLOCKED','COMPLETED_FALLBACK') THEN
        RAISE EXCEPTION 'terminalize_generation: unsupported terminal status % (CANCELLED must use cancel_generation)',
            p_to_status;
    END IF;
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'terminalize_generation: event_type is required';
    END IF;
    -- INV-GEN-003: the terminal event type must match the terminal state.
    IF NOT (
        (p_to_status = 'FAILED_FINAL' AND p_event_type = 'chat.failed')
        OR (p_to_status = 'OUTPUT_BLOCKED' AND p_event_type = 'chat.blocked')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND p_event_type = 'chat.completed')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: event type % does not match terminal status %',
            p_event_type, p_to_status;
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'terminalize_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- generation-states.yaml legal edges for these three terminal states:
    --   FAILED_FINAL        <- IN_PROGRESS, WAITING_FOR_CAPACITY, COMMITTING
    --   OUTPUT_BLOCKED      <- FINAL_REVIEW
    --   COMPLETED_FALLBACK  <- COMMITTING
    IF NOT (
        (p_to_status = 'FAILED_FINAL'
            AND v_status IN ('IN_PROGRESS','WAITING_FOR_CAPACITY','COMMITTING'))
        OR (p_to_status = 'OUTPUT_BLOCKED' AND v_status = 'FINAL_REVIEW')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND v_status = 'COMMITTING')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: illegal transition % -> %',
            v_status, p_to_status;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

    -- Durable terminal event, PENDING only (published post-commit), matching
    -- finalize_generation's chat.completed (V7). TASK-0100 P2-09: allocated
    -- from the shared stream allocator inside this terminal transaction so the
    -- event carries the real (stream_epoch, event_seq).
    PERFORM vc.append_terminal_event(
        p_owner_user_id, p_generation_id, p_event_type,
        COALESCE(p_payload, '{}'::jsonb));

    RETURN p_to_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.terminalize_generation(bigint, bigint, text, text, jsonb)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.terminalize_generation(bigint, bigint, text, text, jsonb)
    TO vc_api;

-- 4. insert_generation_candidate: finalize prerequisite (V7 requires
--    p_final_candidate_id to already exist). Terminal generations accept no
--    new candidates (INV-GEN-003). The generation_candidate_one_final partial
--    unique index rejects a second final candidate (INV-GEN-002). TASK-0098
--    P2-10: the status read takes the generation row lock (FOR UPDATE) and the
--    terminal-state check is re-evaluated under that lock, so a concurrent
--    terminal transition can never commit between the check and the insert
--    (no late candidates into a terminal generation).
CREATE SEQUENCE IF NOT EXISTS vc.generation_candidate_id_seq;

CREATE OR REPLACE FUNCTION vc.insert_generation_candidate(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_content        text,
    p_is_final       boolean DEFAULT false
)
    RETURNS TABLE(out_candidate_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
    v_id     bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'insert_generation_candidate: owner_user_id and generation_id are required';
    END IF;
    IF p_content IS NULL OR btrim(p_content) = '' THEN
        RAISE EXCEPTION 'insert_generation_candidate: content is required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- P2-10: lock the generation row before checking status so a concurrent
    -- finalize/cancel/terminalize winner is observed under our lock instead of
    -- racing the insert.
    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'insert_generation_candidate: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;
    IF v_status IN ('INPUT_BLOCKED','COMPLETED','COMPLETED_FALLBACK','CANCELLED',
                    'OUTPUT_BLOCKED','FAILED_FINAL') THEN
        RAISE EXCEPTION 'insert_generation_candidate: cannot insert into a terminal generation';
    END IF;

    v_id := nextval('vc.generation_candidate_id_seq');
    INSERT INTO vc.generation_candidate(
        owner_user_id, id, generation_id, content, is_final)
    VALUES (
        p_owner_user_id, v_id, p_generation_id, p_content, COALESCE(p_is_final, false));

    RETURN QUERY SELECT v_id;
END;
$$;

GRANT USAGE, SELECT ON SEQUENCE vc.generation_candidate_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

REVOKE EXECUTE ON FUNCTION
    vc.insert_generation_candidate(bigint, bigint, text, boolean)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.insert_generation_candidate(bigint, bigint, text, boolean)
    TO vc_api;

-- 5. record_quota_release: RELEASE ledger row for degraded/failed paths
--    (success keeps its reservation for finalize's atomic SETTLE, V7).
CREATE OR REPLACE FUNCTION vc.record_quota_release(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_quota_amount   integer,
    p_reason         text
)
    RETURNS TABLE(out_entry_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'record_quota_release: owner_user_id and generation_id are required';
    END IF;
    IF p_quota_amount IS NULL OR p_quota_amount < 0 THEN
        RAISE EXCEPTION 'record_quota_release: quota_amount must be non-negative';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION 'record_quota_release: reason is required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_quota_release: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    v_id := nextval('vc.finalize_row_id_seq');
    INSERT INTO vc.quota_ledger_entry(
        owner_user_id, id, generation_id, kind, quota_amount, reason)
    VALUES (
        p_owner_user_id, v_id, p_generation_id, 'RELEASE', p_quota_amount, p_reason);

    RETURN QUERY SELECT v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.record_quota_release(bigint, bigint, integer, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.record_quota_release(bigint, bigint, integer, text)
    TO vc_api;
