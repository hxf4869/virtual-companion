-- G10 / redesign §15.1 §16: additive Go generation/jobs write path.
-- legacy runtime create_attempt_intent / record_attempt_outcome / finalize_generation /
-- recover_expired_claims stay untouched. Go uses the go_* functions only.
-- Destructive rename of attempt_intent → model_attempt is G13.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. Extend attempt_intent to the ModelAttempt shape without dual-write.
--    legacy snapshot FKs become optional so Go can omit dual auth snapshots.
-- ---------------------------------------------------------------------------
ALTER TABLE vc.attempt_intent
    ALTER COLUMN requested_authorization_snapshot DROP NOT NULL,
    ALTER COLUMN execution_authorization_snapshot DROP NOT NULL;

ALTER TABLE vc.attempt_intent
    DROP CONSTRAINT IF EXISTS attempt_intent_release_bundle_shape_check;
ALTER TABLE vc.attempt_intent
    ADD CONSTRAINT attempt_intent_release_bundle_shape_check CHECK (
        (model_id IS NULL
         AND model_revision IS NULL
         AND prompt_bundle_version IS NULL
         AND persona_bundle_version IS NULL
         AND config_version IS NULL
         AND release_stage IS NULL
         AND release_policy_version IS NULL)
        OR
        (model_id IS NOT NULL AND btrim(model_id) <> ''
         AND model_revision IS NOT NULL AND btrim(model_revision) <> ''
         AND prompt_bundle_version IS NOT NULL AND btrim(prompt_bundle_version) <> ''
         AND persona_bundle_version IS NOT NULL AND btrim(persona_bundle_version) <> ''
         AND config_version IS NOT NULL AND btrim(config_version) <> ''
         AND release_stage IN ('CANARY', 'BETA')
         AND release_policy_version IS NOT NULL AND btrim(release_policy_version) <> '')
        OR
        (release_stage IS NULL
         AND release_policy_version IS NULL
         AND model_id IS NULL
         AND model_revision IS NULL)
    );

ALTER TABLE vc.attempt_intent
    ADD COLUMN IF NOT EXISTS attempt_no integer,
    ADD COLUMN IF NOT EXISTS effective_categories text[],
    ADD COLUMN IF NOT EXISTS consent_version text,
    ADD COLUMN IF NOT EXISTS provider_contract_version text,
    ADD COLUMN IF NOT EXISTS input_tokens bigint,
    ADD COLUMN IF NOT EXISTS output_tokens bigint,
    ADD COLUMN IF NOT EXISTS billing_disposition text,
    ADD COLUMN IF NOT EXISTS reserved_cost bigint,
    ADD COLUMN IF NOT EXISTS actual_cost bigint;

ALTER TABLE vc.attempt_intent
    DROP CONSTRAINT IF EXISTS attempt_intent_go_attempt_no_pos,
    DROP CONSTRAINT IF EXISTS attempt_intent_go_billing_check,
    DROP CONSTRAINT IF EXISTS attempt_intent_go_tokens_check,
    DROP CONSTRAINT IF EXISTS attempt_intent_go_cost_check;

ALTER TABLE vc.attempt_intent
    ADD CONSTRAINT attempt_intent_go_attempt_no_pos
        CHECK (attempt_no IS NULL OR attempt_no > 0),
    ADD CONSTRAINT attempt_intent_go_billing_check
        CHECK (billing_disposition IS NULL
            OR billing_disposition IN ('NOT_SENT', 'USAGE_REPORTED', 'UNKNOWN')),
    ADD CONSTRAINT attempt_intent_go_tokens_check
        CHECK ((input_tokens IS NULL OR input_tokens >= 0)
           AND (output_tokens IS NULL OR output_tokens >= 0)),
    ADD CONSTRAINT attempt_intent_go_cost_check
        CHECK ((reserved_cost IS NULL OR reserved_cost >= 0)
           AND (actual_cost IS NULL OR actual_cost >= 0));

CREATE UNIQUE INDEX IF NOT EXISTS attempt_intent_go_attempt_no_uidx
    ON vc.attempt_intent (owner_user_id, generation_id, attempt_no)
    WHERE attempt_no IS NOT NULL;

ALTER TABLE vc.work_item
    ADD COLUMN IF NOT EXISTS last_error_code text,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE vc.generation
    ADD COLUMN IF NOT EXISTS cancel_requested boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS vc.go_monthly_cost (
    owner_user_id bigint NOT NULL,
    period_ym     char(7) NOT NULL,
    used          bigint NOT NULL DEFAULT 0,
    reserved      bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (owner_user_id, period_ym),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT go_monthly_cost_nonneg CHECK (used >= 0 AND reserved >= 0),
    CONSTRAINT go_monthly_cost_period CHECK (period_ym ~ '^[0-9]{4}-[0-9]{2}$')
);

ALTER TABLE vc.go_monthly_cost ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.go_monthly_cost FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.go_monthly_cost;
CREATE POLICY owner_isolation ON vc.go_monthly_cost FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON TABLE vc.go_monthly_cost FROM PUBLIC;

-- Scheduler names for retained Go jobs. DAU_METRICS stays in the check for
-- legacy runtime rows but Go never acquires it.
ALTER TABLE vc.job_lease DROP CONSTRAINT IF EXISTS job_lease_name;
ALTER TABLE vc.job_lease ADD CONSTRAINT job_lease_name CHECK (job_name IN (
    'RETENTION_PURGE', 'AUTH_EVENT_PURGE', 'DAU_METRICS', 'EXPORT_EXPIRY',
    'SESSION_CLEANUP'));
ALTER TABLE vc.job_run DROP CONSTRAINT IF EXISTS job_run_name;
ALTER TABLE vc.job_run ADD CONSTRAINT job_run_name CHECK (job_name IN (
    'RETENTION_PURGE', 'AUTH_EVENT_PURGE', 'DAU_METRICS', 'EXPORT_EXPIRY',
    'SESSION_CLEANUP'));
INSERT INTO vc.job_lease(job_name) VALUES ('SESSION_CLEANUP')
ON CONFLICT (job_name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_sha256_hex(p_value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    SET search_path = vc, pg_catalog
AS $$
    SELECT encode(digest(p_value, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION vc.go_period_ym()
    RETURNS char(7)
    LANGUAGE sql
    STABLE
    SET search_path = vc, pg_catalog
AS $$
    SELECT to_char((clock_timestamp() AT TIME ZONE 'UTC'), 'YYYY-MM');
$$;

CREATE OR REPLACE FUNCTION vc.go_assert_owner(p_owner_user_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_assert_live_claim(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM 1
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.id = p_work_item_id
       AND wi.status = 'CLAIMED'
       AND wi.claim_token = p_claim_token
       AND wi.claim_fence = p_claim_fence
       AND wi.lease_expires_at > clock_timestamp()
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go claim: work item has no live claim matching the presented token/fence (missing, overtaken or lease expired)';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_generation_terminal(p_status text)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT p_status IN (
        'INPUT_BLOCKED', 'COMPLETED', 'COMPLETED_FALLBACK',
        'CANCELLED', 'OUTPUT_BLOCKED', 'FAILED_FINAL');
$$;

CREATE OR REPLACE FUNCTION vc.go_map_attempt_status(p_status text)
    RETURNS text
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    CASE p_status
        WHEN 'CREATED' THEN RETURN 'CREATED';
        WHEN 'SUCCEEDED' THEN RETURN 'SUCCEEDED';
        WHEN 'FAILED' THEN RETURN 'NON_RETRYABLE_FAILED';
        WHEN 'TIMED_OUT' THEN RETURN 'TIMED_OUT';
        WHEN 'CANCELLED' THEN RETURN 'CANCELLED';
        WHEN 'OUTCOME_UNKNOWN' THEN RETURN 'ABANDONED_LATE';
        ELSE
            RAISE EXCEPTION 'go_map_attempt_status: unsupported status';
    END CASE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_map_failure_code(p_physical text, p_failure text)
    RETURNS text
    LANGUAGE plpgsql
    IMMUTABLE
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_physical IN ('CREATED', 'SUCCEEDED', 'CANCELLED', 'ABANDONED_LATE') THEN
        RETURN NULL;
    END IF;
    IF p_physical = 'TIMED_OUT' THEN
        IF p_failure IN ('TIMEOUT_CONNECT', 'TIMEOUT_FIRST_TOKEN', 'TIMEOUT_TOTAL') THEN
            RETURN p_failure;
        END IF;
        RETURN 'TIMEOUT_TOTAL';
    END IF;
    IF p_failure IN ('HTTP_429', 'RATE_LIMITED') THEN
        RETURN 'HTTP_429';
    END IF;
    IF p_failure IN ('HTTP_5XX', 'UPSTREAM_UNAVAILABLE') THEN
        RETURN 'HTTP_5XX';
    END IF;
    IF p_failure IN ('DISCONNECTED', 'MALFORMED') THEN
        RETURN 'DISCONNECTED';
    END IF;
    IF p_failure IN ('TIMEOUT_CONNECT', 'TIMEOUT_FIRST_TOKEN', 'TIMEOUT_TOTAL') THEN
        RETURN p_failure;
    END IF;
    RETURN 'OTHER';
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_reserve_cost(
    p_owner_user_id bigint,
    p_amount bigint,
    p_hard_limit bigint)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_period char(7);
    v_used bigint;
    v_reserved bigint;
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN;
    END IF;
    IF p_hard_limit IS NULL OR p_hard_limit <= 0 THEN
        RAISE EXCEPTION 'go cost: monthly cost hard limit is required when reserving';
    END IF;
    v_period := vc.go_period_ym();
    INSERT INTO vc.go_monthly_cost(owner_user_id, period_ym)
    VALUES (p_owner_user_id, v_period)
    ON CONFLICT (owner_user_id, period_ym) DO NOTHING;

    SELECT used, reserved INTO v_used, v_reserved
      FROM vc.go_monthly_cost
     WHERE owner_user_id = p_owner_user_id AND period_ym = v_period
     FOR UPDATE;
    IF v_used + v_reserved + p_amount > p_hard_limit THEN
        RAISE EXCEPTION 'go cost: monthly cost hard cap exceeded';
    END IF;
    UPDATE vc.go_monthly_cost
       SET reserved = reserved + p_amount
     WHERE owner_user_id = p_owner_user_id AND period_ym = v_period;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_close_reservation(
    p_owner_user_id bigint,
    p_reserved bigint,
    p_disposition text,
    p_actual bigint)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_period char(7);
    v_release bigint;
    v_settle bigint;
BEGIN
    IF p_reserved IS NULL OR p_reserved <= 0 THEN
        RETURN;
    END IF;
    v_period := vc.go_period_ym();
    v_release := p_reserved;
    v_settle := 0;
    IF p_disposition = 'USAGE_REPORTED' THEN
        v_settle := GREATEST(COALESCE(p_actual, 0), 0);
    ELSIF p_disposition = 'UNKNOWN' OR p_disposition IS NULL THEN
        v_settle := p_reserved;
    END IF;
    UPDATE vc.go_monthly_cost
       SET reserved = reserved - v_release,
           used = used + v_settle
     WHERE owner_user_id = p_owner_user_id
       AND period_ym = v_period
       AND reserved >= v_release;
    IF NOT FOUND THEN
        -- Period rolled or already closed: do not double-count.
        RETURN;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_close_job(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_status text,
    p_error_code text)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_status NOT IN ('DONE', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'go_close_job: unsupported status';
    END IF;
    UPDATE vc.work_item
       SET status = p_status,
           last_error_code = p_error_code,
           finished_at = clock_timestamp(),
           claim_token = NULL,
           claim_fence = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_work_item_id
       AND status IN ('PENDING', 'CLAIMED');
END;
$$;

-- ---------------------------------------------------------------------------
-- Intake
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_start_turn(
    p_owner_user_id bigint,
    p_conversation_id bigint,
    p_idempotency_key text,
    p_user_content text,
    p_mode text,
    p_source_user_message_id bigint,
    p_max_outstanding integer)
    RETURNS TABLE(
        out_generation_id bigint,
        out_logical_generation_id text,
        out_conversation_id bigint,
        out_status text,
        out_mode text,
        out_created boolean,
        out_created_at timestamptz,
        out_job_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_logical text;
    v_gen bigint;
    v_msg bigint;
    v_created boolean;
    v_mode text;
    v_status text;
    v_created_at timestamptz;
    v_job bigint;
    v_outstanding integer;
    v_recv record;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'go_start_turn: conversation not found';
    END IF;
    IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' OR char_length(p_idempotency_key) > 128 THEN
        RAISE EXCEPTION 'go_start_turn: idempotency_key is invalid';
    END IF;
    IF p_max_outstanding IS NULL OR p_max_outstanding < 1 THEN
        RAISE EXCEPTION 'go_start_turn: max outstanding must be positive';
    END IF;
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'go_start_turn: owner deletion is in progress';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('vc.go_start_turn.outstanding:' || p_owner_user_id::text));

    PERFORM 1 FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id AND c.id = p_conversation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_start_turn: conversation not found';
    END IF;

    v_mode := CASE
        WHEN p_mode IN ('AUTO', 'LISTEN', 'DISCUSS', 'CASUAL') THEN p_mode
        ELSE 'AUTO'
    END;

    SELECT g.id, g.logical_generation_id, g.status, g.created_at
      INTO v_gen, v_logical, v_status, v_created_at
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.idempotency_key = p_idempotency_key;
    IF FOUND THEN
        SELECT wi.id INTO v_job
          FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id
           AND wi.kind = 'GENERATION'
           AND wi.ref_id = v_gen
         ORDER BY wi.id
         LIMIT 1;
        RETURN QUERY SELECT v_gen, v_logical, p_conversation_id, v_status, v_mode,
                            false, v_created_at, v_job;
        RETURN;
    END IF;

    SELECT count(*) INTO v_outstanding
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND NOT vc.go_generation_terminal(g.status);
    IF v_outstanding >= p_max_outstanding THEN
        RAISE EXCEPTION 'go_start_turn: outstanding generations exceeded';
    END IF;

    IF p_source_user_message_id IS NOT NULL THEN
        SELECT * INTO v_recv
          FROM vc.receive_generation(
              p_owner_user_id, p_conversation_id, p_idempotency_key,
              'user', COALESCE(p_user_content, ''), v_mode, p_source_user_message_id);
    ELSE
        IF p_user_content IS NULL OR p_user_content = '' THEN
            RAISE EXCEPTION 'go_start_turn: user content is required';
        END IF;
        SELECT * INTO v_recv
          FROM vc.receive_generation(
              p_owner_user_id, p_conversation_id, p_idempotency_key,
              'user', p_user_content, v_mode);
    END IF;

    v_logical := v_recv.logical_generation_id;
    v_gen := v_recv.generation_id;
    v_msg := v_recv.message_id;
    v_created := v_recv.created;

    SELECT g.status, g.created_at, g.mode
      INTO v_status, v_created_at, v_mode
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = v_gen;

    IF v_created THEN
        UPDATE vc.generation
           SET status = 'QUEUED'
         WHERE owner_user_id = p_owner_user_id
           AND id = v_gen
           AND status = 'CREATED';
        v_status := 'QUEUED';
        v_job := vc.enqueue_work_item(p_owner_user_id, 'GENERATION', v_gen, NULL);
    ELSE
        SELECT wi.id INTO v_job
          FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id
           AND wi.kind = 'GENERATION'
           AND wi.ref_id = v_gen
         ORDER BY wi.id
         LIMIT 1;
    END IF;

    RETURN QUERY SELECT v_gen, v_logical, p_conversation_id, v_status, v_mode,
                        v_created, v_created_at, v_job;
END;
$$;

-- ---------------------------------------------------------------------------
-- Claim (cross-owner, worker). Never claims MEMORY_EXTRACT.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_claim_jobs(
    p_generation_lease_seconds integer,
    p_export_lease_seconds integer,
    p_default_lease_seconds integer,
    p_limit integer)
    RETURNS TABLE(
        out_owner_user_id bigint,
        out_job_id bigint,
        out_kind text,
        out_ref_id bigint,
        out_claim_token text,
        out_claim_fence text,
        out_lease_seconds integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit integer;
BEGIN
    IF p_generation_lease_seconds IS NULL OR p_generation_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: generation lease must be >= 5s';
    END IF;
    IF p_export_lease_seconds IS NULL OR p_export_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: export lease must be >= 5s';
    END IF;
    IF p_default_lease_seconds IS NULL OR p_default_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: default lease must be >= 5s';
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);

    RETURN QUERY
    WITH picked AS (
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind IN ('GENERATION', 'DATA_EXPORT')
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    )
    UPDATE vc.work_item wi
       SET status = 'CLAIMED',
           claim_token = gen_random_uuid()::text,
           claim_fence = gen_random_uuid()::text,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs =>
               CASE wi.kind
                   WHEN 'GENERATION' THEN p_generation_lease_seconds
                   WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                   ELSE p_default_lease_seconds
               END)
      FROM picked p
     WHERE wi.owner_user_id = p.owner_user_id AND wi.id = p.id
    RETURNING wi.owner_user_id, wi.id, wi.kind, wi.ref_id, wi.claim_token, wi.claim_fence,
              CASE wi.kind
                  WHEN 'GENERATION' THEN p_generation_lease_seconds
                  WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                  ELSE p_default_lease_seconds
              END;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_promote_claimed_generation(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_cancel boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);

    SELECT g.status, g.cancel_requested
      INTO v_status, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_promote_claimed_generation: generation not found';
    END IF;
    IF vc.go_generation_terminal(v_status) THEN
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'DONE', NULL);
        RETURN v_status;
    END IF;
    IF v_cancel THEN
        RETURN v_status;
    END IF;
    IF v_status IN ('CREATED', 'QUEUED') THEN
        UPDATE vc.generation
           SET status = 'IN_PROGRESS'
         WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
        RETURN 'IN_PROGRESS';
    END IF;
    RETURN v_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attempt intent / outcome
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_create_model_attempt(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_generation_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_provider_id text,
    p_supplier_name text,
    p_model_id text,
    p_effective_categories text[],
    p_consent_version text,
    p_provider_contract_version text,
    p_prompt_version text,
    p_persona_version text,
    p_config_version text,
    p_reserved_cost bigint,
    p_hard_limit bigint)
    RETURNS TABLE(out_attempt_id bigint, out_attempt_no integer, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_no integer;
    v_paid text;
    v_status text;
    v_cancel boolean;
    v_kind text;
    v_ref bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);
    IF p_provider_id IS NULL OR btrim(p_provider_id) = ''
       OR p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'go_create_model_attempt: provider identity is required';
    END IF;

    SELECT wi.kind, wi.ref_id INTO v_kind, v_ref
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id;
    IF v_kind IS DISTINCT FROM 'GENERATION' OR v_ref IS DISTINCT FROM p_generation_id THEN
        RAISE EXCEPTION 'go_create_model_attempt: job is not this generation';
    END IF;

    SELECT g.status, g.cancel_requested
      INTO v_status, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_create_model_attempt: generation not found';
    END IF;
    IF vc.go_generation_terminal(v_status) THEN
        RAISE EXCEPTION 'go_create_model_attempt: generation already terminal';
    END IF;
    IF v_cancel OR v_status = 'CANCEL_REQUESTED' THEN
        RAISE EXCEPTION 'go_create_model_attempt: generation cancel requested';
    END IF;

    SELECT COALESCE(max(a.attempt_no), 0) + 1 INTO v_no
      FROM vc.attempt_intent a
     WHERE a.owner_user_id = p_owner_user_id AND a.generation_id = p_generation_id;

    PERFORM vc.go_reserve_cost(p_owner_user_id, COALESCE(p_reserved_cost, 0), p_hard_limit);

    v_id := nextval('vc.attempt_intent_id_seq');
    v_paid := gen_random_uuid()::text;
    INSERT INTO vc.attempt_intent(
        owner_user_id, id, work_item_id, generation_id, provider_attempt_id,
        provider_id, supplier_name, status,
        claim_token_hash, claim_fence_hash,
        requested_authorization_snapshot, execution_authorization_snapshot,
        attempt_started_at, attempt_no, effective_categories,
        consent_version, provider_contract_version,
        prompt_bundle_version, persona_bundle_version, config_version,
        reserved_cost)
    VALUES (
        p_owner_user_id, v_id, p_work_item_id, p_generation_id, v_paid,
        btrim(p_provider_id), btrim(p_supplier_name), 'CREATED',
        vc.go_sha256_hex(p_claim_token), vc.go_sha256_hex(p_claim_fence),
        NULL, NULL,
        clock_timestamp(), v_no, p_effective_categories,
        NULLIF(btrim(COALESCE(p_consent_version, '')), ''),
        NULLIF(btrim(COALESCE(p_provider_contract_version, '')), ''),
        NULLIF(btrim(COALESCE(p_prompt_version, '')), ''),
        NULLIF(btrim(COALESCE(p_persona_version, '')), ''),
        NULLIF(btrim(COALESCE(p_config_version, '')), ''),
        COALESCE(p_reserved_cost, 0));

    RETURN QUERY SELECT v_id, v_no, v_paid;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_record_attempt_outcome(
    p_owner_user_id bigint,
    p_attempt_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_logical_status text,
    p_failure_code text,
    p_billing_disposition text,
    p_input_tokens bigint,
    p_output_tokens bigint,
    p_actual_cost bigint)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_physical text;
    v_fail text;
    v_rows integer;
    v_reserved bigint;
    v_disp text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);
    IF p_billing_disposition NOT IN ('NOT_SENT', 'USAGE_REPORTED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'go_record_attempt_outcome: unsupported billing disposition';
    END IF;
    v_physical := vc.go_map_attempt_status(p_logical_status);
    v_fail := vc.go_map_failure_code(v_physical, p_failure_code);
    v_disp := p_billing_disposition;

    UPDATE vc.attempt_intent
       SET status = v_physical,
           failure_code = v_fail,
           billing_disposition = v_disp,
           input_tokens = COALESCE(p_input_tokens, 0),
           output_tokens = COALESCE(p_output_tokens, 0),
           actual_cost = COALESCE(p_actual_cost, 0),
           terminal_at = clock_timestamp()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_attempt_id
       AND work_item_id = p_work_item_id
       AND status = 'CREATED'
    RETURNING reserved_cost INTO v_reserved;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 1 THEN
        PERFORM vc.go_close_reservation(
            p_owner_user_id, COALESCE(v_reserved, 0), v_disp, COALESCE(p_actual_cost, 0));
    END IF;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- Finalize / terminalize / cancel
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_finalize_generation(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_attempt_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_assistant_content text)
    RETURNS TABLE(out_generation_id bigint, out_assistant_message_id bigint, out_finalized boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_conv bigint;
    v_status text;
    v_assistant bigint;
    v_att_status text;
    v_att_billing text;
    v_msg bigint;
    v_cancel boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);
    IF p_assistant_content IS NULL OR p_assistant_content = '' THEN
        RAISE EXCEPTION 'go_finalize_generation: assistant content is required';
    END IF;

    SELECT g.conversation_id, g.status, g.assistant_message_id, g.cancel_requested
      INTO v_conv, v_status, v_assistant, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_finalize_generation: generation not found';
    END IF;
    IF v_status = 'COMPLETED' AND v_assistant IS NOT NULL THEN
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'DONE', NULL);
        RETURN QUERY SELECT p_generation_id, v_assistant, false;
        RETURN;
    END IF;
    IF v_cancel OR v_status IN ('CANCEL_REQUESTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'go_finalize_generation: generation cancel requested';
    END IF;
    IF vc.go_generation_terminal(v_status) THEN
        RAISE EXCEPTION 'go_finalize_generation: generation already terminal';
    END IF;

    SELECT a.status, a.billing_disposition
      INTO v_att_status, v_att_billing
      FROM vc.attempt_intent a
     WHERE a.owner_user_id = p_owner_user_id
       AND a.id = p_attempt_id
       AND a.generation_id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_finalize_generation: attempt not found';
    END IF;
    IF v_att_status IS DISTINCT FROM 'SUCCEEDED' THEN
        RAISE EXCEPTION 'go_finalize_generation: attempt is not succeeded';
    END IF;
    IF v_att_billing IS NULL THEN
        RAISE EXCEPTION 'go_finalize_generation: attempt reservation is not closed';
    END IF;

    -- Catalog hops: IN_PROGRESS/QUEUED → FINAL_REVIEW → COMMITTING → COMPLETED.
    IF v_status IN ('CREATED', 'QUEUED', 'IN_PROGRESS') THEN
        UPDATE vc.generation SET status = 'FINAL_REVIEW'
         WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
        v_status := 'FINAL_REVIEW';
    END IF;
    IF v_status = 'FINAL_REVIEW' THEN
        UPDATE vc.generation SET status = 'COMMITTING'
         WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
        v_status := 'COMMITTING';
    END IF;
    IF v_status IS DISTINCT FROM 'COMMITTING' THEN
        RAISE EXCEPTION 'go_finalize_generation: illegal transition';
    END IF;

    v_msg := nextval('vc.message_id_seq');
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (p_owner_user_id, v_msg, v_conv, 'assistant', p_assistant_content);

    UPDATE vc.generation
       SET status = 'COMPLETED',
           assistant_message_id = v_msg,
           cancel_requested = false
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;

    PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'DONE', NULL);
    RETURN QUERY SELECT p_generation_id, v_msg, true;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_terminalize_generation(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_phase text,
    p_reason text)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_target text;
    v_job_status text;
    v_cancel boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    IF p_claim_token IS NOT NULL AND p_claim_token <> '' THEN
        PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);
    END IF;

    SELECT g.status, g.cancel_requested
      INTO v_status, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_terminalize_generation: generation not found';
    END IF;
    IF vc.go_generation_terminal(v_status) THEN
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id,
            CASE WHEN v_status = 'CANCELLED' THEN 'CANCELLED'
                 WHEN v_status = 'COMPLETED' THEN 'DONE'
                 ELSE 'FAILED' END,
            p_reason);
        RETURN v_status;
    END IF;

    IF v_cancel OR p_phase = 'CANCELLED' THEN
        v_target := 'CANCELLED';
        v_job_status := 'CANCELLED';
    ELSIF p_phase = 'BLOCKED' THEN
        v_job_status := 'FAILED';
        IF v_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW') THEN
            UPDATE vc.generation SET status = 'INPUT_REVIEW'
             WHERE owner_user_id = p_owner_user_id AND id = p_generation_id
               AND status IS DISTINCT FROM 'INPUT_REVIEW';
            v_target := 'INPUT_BLOCKED';
        ELSE
            IF v_status IS DISTINCT FROM 'FINAL_REVIEW' THEN
                UPDATE vc.generation SET status = 'FINAL_REVIEW'
                 WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
            END IF;
            v_target := 'OUTPUT_BLOCKED';
        END IF;
    ELSE
        v_target := 'FAILED_FINAL';
        v_job_status := 'FAILED';
        IF v_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
            UPDATE vc.generation SET status = 'IN_PROGRESS'
             WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
        END IF;
    END IF;

    UPDATE vc.generation
       SET status = v_target
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;

    IF v_target IN ('INPUT_BLOCKED', 'OUTPUT_BLOCKED', 'CANCELLED') THEN
        PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, p_generation_id);
    END IF;

    PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, v_job_status, p_reason);
    RETURN v_target;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_request_cancel(
    p_owner_user_id bigint,
    p_generation_id bigint)
    RETURNS TABLE(out_generation_id bigint, out_status text, out_logical_generation_id text,
                  out_conversation_id bigint, out_mode text, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_logical text;
    v_conv bigint;
    v_mode text;
    v_created timestamptz;
    v_job bigint;
    v_job_status text;
    rec record;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT g.status, g.logical_generation_id, g.conversation_id, g.mode, g.created_at
      INTO v_status, v_logical, v_conv, v_mode, v_created
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_request_cancel: generation not found';
    END IF;

    SELECT wi.id, wi.status INTO v_job, v_job_status
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.kind = 'GENERATION'
       AND wi.ref_id = p_generation_id
     ORDER BY wi.id
     LIMIT 1
     FOR UPDATE;

    IF v_status = 'CANCELLED' THEN
        RETURN QUERY SELECT p_generation_id, v_status, v_logical, v_conv, v_mode, v_created;
        RETURN;
    END IF;
    IF vc.go_generation_terminal(v_status) OR v_status = 'COMMITTING' THEN
        RAISE EXCEPTION 'go_request_cancel: generation is not cancellable';
    END IF;

    UPDATE vc.generation
       SET cancel_requested = true
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;

    FOR rec IN
        SELECT a.id, a.status, a.billing_disposition, a.reserved_cost
          FROM vc.attempt_intent a
         WHERE a.owner_user_id = p_owner_user_id
           AND a.generation_id = p_generation_id
         ORDER BY a.attempt_no NULLS LAST, a.id
         FOR UPDATE
    LOOP
        IF rec.status = 'CREATED' THEN
            UPDATE vc.attempt_intent
               SET status = 'ABANDONED_LATE',
                   billing_disposition = 'UNKNOWN',
                   terminal_at = clock_timestamp()
             WHERE owner_user_id = p_owner_user_id AND id = rec.id;
            PERFORM vc.go_close_reservation(p_owner_user_id, COALESCE(rec.reserved_cost, 0), 'UNKNOWN', 0);
        END IF;
    END LOOP;

    UPDATE vc.generation
       SET status = 'CANCEL_REQUESTED'
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
    UPDATE vc.generation
       SET status = 'CANCELLED'
     WHERE owner_user_id = p_owner_user_id AND id = p_generation_id;
    PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, p_generation_id);

    IF v_job IS NOT NULL THEN
        PERFORM vc.go_close_job(p_owner_user_id, v_job, 'CANCELLED', 'CANCELED');
    END IF;

    SELECT g.status, g.logical_generation_id, g.conversation_id, g.mode, g.created_at
      INTO v_status, v_logical, v_conv, v_mode, v_created
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id;

    RETURN QUERY SELECT p_generation_id, v_status, v_logical, v_conv, v_mode, v_created;
END;
$$;

-- ---------------------------------------------------------------------------
-- Crash recovery §16.2.1
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_list_expired_generation_jobs(p_limit integer)
    RETURNS TABLE(out_owner_user_id bigint, out_job_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.kind = 'GENERATION'
           AND wi.status = 'CLAIMED'
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
         ORDER BY wi.lease_expires_at, wi.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_recover_expired_generation(
    p_owner_user_id bigint,
    p_work_item_id bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind text;
    v_ref bigint;
    v_job_status text;
    v_gen_status text;
    v_assistant bigint;
    v_cancel boolean;
    v_action text;
    rec record;
    v_current record;
    v_has_attempt boolean := false;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT wi.kind, wi.ref_id, wi.status
      INTO v_kind, v_ref, v_job_status
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
     FOR UPDATE;
    IF NOT FOUND OR v_kind IS DISTINCT FROM 'GENERATION' THEN
        RAISE EXCEPTION 'go_recover_expired_generation: generation job not found';
    END IF;

    SELECT g.status, g.assistant_message_id, g.cancel_requested
      INTO v_gen_status, v_assistant, v_cancel
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = v_ref
     FOR UPDATE;
    IF NOT FOUND THEN
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', 'GENERATION_MISSING');
        RETURN 'JOB_CLOSED_MISSING_GENERATION';
    END IF;

    -- 1. generation already terminal.
    IF vc.go_generation_terminal(v_gen_status) THEN
        IF v_gen_status = 'COMPLETED' AND v_assistant IS NULL THEN
            RAISE EXCEPTION 'go_recover_expired_generation: COMPLETED generation has no final message';
        END IF;
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id,
            CASE WHEN v_gen_status = 'CANCELLED' THEN 'CANCELLED'
                 WHEN v_gen_status = 'COMPLETED' THEN 'DONE'
                 ELSE 'FAILED' END,
            NULL);
        RETURN 'IDEMPOTENT_TERMINAL';
    END IF;

    FOR rec IN
        SELECT a.id, a.attempt_no, a.status, a.billing_disposition, a.reserved_cost
          FROM vc.attempt_intent a
         WHERE a.owner_user_id = p_owner_user_id
           AND a.generation_id = v_ref
         ORDER BY a.attempt_no NULLS LAST, a.id
         FOR UPDATE
    LOOP
        v_has_attempt := true;
        v_current := rec;
        IF rec.status <> 'CREATED' THEN
            -- 8. already terminal: converge reservation by persisted disposition.
            PERFORM vc.go_close_reservation(
                p_owner_user_id,
                COALESCE(rec.reserved_cost, 0),
                rec.billing_disposition,
                0);
        END IF;
    END LOOP;

    -- 2. no attempt intent: requeue.
    IF NOT v_has_attempt THEN
        UPDATE vc.work_item
           SET status = 'PENDING',
               claim_token = NULL,
               claim_fence = NULL,
               claimed_at = NULL,
               lease_expires_at = NULL,
               next_attempt_at = NULL
         WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
        RETURN 'REQUEUE_NO_INTENT';
    END IF;

    -- 3-7. never requeue; never create a new attempt.
    IF v_current.status = 'CREATED' THEN
        -- 4 / 7: non-terminal CREATED → OUTCOME_UNKNOWN (physical ABANDONED_LATE).
        UPDATE vc.attempt_intent
           SET status = 'ABANDONED_LATE',
               billing_disposition = 'UNKNOWN',
               terminal_at = clock_timestamp()
         WHERE owner_user_id = p_owner_user_id AND id = v_current.id;
        PERFORM vc.go_close_reservation(
            p_owner_user_id, COALESCE(v_current.reserved_cost, 0), 'UNKNOWN', 0);
        IF v_cancel THEN
            UPDATE vc.generation SET status = 'CANCELLED', cancel_requested = true
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
            PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, v_ref);
            PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'CANCELLED', 'CANCELED');
            RETURN 'CANCELLED_OUTCOME_UNKNOWN';
        END IF;
        IF v_gen_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
            UPDATE vc.generation SET status = 'IN_PROGRESS'
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        END IF;
        UPDATE vc.generation SET status = 'FAILED_FINAL'
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', 'PROVIDER_OUTCOME_UNKNOWN');
        RETURN 'OUTCOME_UNKNOWN';
    END IF;

    IF v_current.status = 'SUCCEEDED' THEN
        -- 5. candidate lost after attempt.
        IF v_cancel THEN
            UPDATE vc.generation SET status = 'CANCELLED', cancel_requested = true
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
            PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, v_ref);
            PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'CANCELLED', 'CANCELED');
            RETURN 'CANCELLED_AFTER_SUCCESS';
        END IF;
        IF v_gen_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
            UPDATE vc.generation SET status = 'IN_PROGRESS'
             WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        END IF;
        UPDATE vc.generation SET status = 'FAILED_FINAL'
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', 'CANDIDATE_LOST_AFTER_ATTEMPT');
        RETURN 'CANDIDATE_LOST_AFTER_ATTEMPT';
    END IF;

    -- 6 / 7. other terminal attempts.
    IF v_cancel THEN
        UPDATE vc.generation SET status = 'CANCELLED', cancel_requested = true
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
        PERFORM vc.mark_turn_messages_model_ineligible(p_owner_user_id, v_ref);
        PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'CANCELLED', 'CANCELED');
        RETURN 'CANCELLED_KEEP_ATTEMPT';
    END IF;
    IF v_gen_status IN ('CREATED', 'QUEUED', 'INPUT_REVIEW', 'FINAL_REVIEW') THEN
        UPDATE vc.generation SET status = 'IN_PROGRESS'
         WHERE owner_user_id = p_owner_user_id AND id = v_ref;
    END IF;
    UPDATE vc.generation SET status = 'FAILED_FINAL'
     WHERE owner_user_id = p_owner_user_id AND id = v_ref;
    v_action := CASE v_current.status
        WHEN 'ABANDONED_LATE' THEN 'PROVIDER_OUTCOME_UNKNOWN'
        WHEN 'TIMED_OUT' THEN 'TIMEOUT'
        WHEN 'CANCELLED' THEN 'CANCELED'
        ELSE 'ATTEMPT_FAILED'
    END;
    PERFORM vc.go_close_job(p_owner_user_id, p_work_item_id, 'FAILED', v_action);
    RETURN v_action;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_expire_queued_generations(p_queue_timeout_seconds integer)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    rec record;
    v_n integer := 0;
BEGIN
    IF p_queue_timeout_seconds IS NULL OR p_queue_timeout_seconds < 1 THEN
        RAISE EXCEPTION 'go_expire_queued_generations: timeout must be positive';
    END IF;
    FOR rec IN
        SELECT wi.owner_user_id, wi.id, wi.ref_id
          FROM vc.work_item wi
         WHERE wi.kind = 'GENERATION'
           AND wi.status = 'PENDING'
           AND wi.created_at <= clock_timestamp() - make_interval(secs => p_queue_timeout_seconds)
         FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE vc.generation
           SET status = CASE
               WHEN status IN ('CREATED', 'QUEUED') THEN 'IN_PROGRESS'
               ELSE status
           END
         WHERE owner_user_id = rec.owner_user_id AND id = rec.ref_id
           AND NOT vc.go_generation_terminal(status);
        UPDATE vc.generation
           SET status = 'FAILED_FINAL'
         WHERE owner_user_id = rec.owner_user_id AND id = rec.ref_id
           AND NOT vc.go_generation_terminal(status);
        PERFORM vc.go_close_job(rec.owner_user_id, rec.id, 'FAILED', 'QUEUE_TIMEOUT');
        v_n := v_n + 1;
    END LOOP;
    RETURN v_n;
END;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_get_generation(
    p_owner_user_id bigint,
    p_generation_id bigint)
    RETURNS TABLE(
        out_generation_id bigint,
        out_conversation_id bigint,
        out_relationship_id bigint,
        out_logical_generation_id text,
        out_status text,
        out_mode text,
        out_created_at timestamptz,
        out_source_message_id bigint,
        out_assistant_message_id bigint,
        out_cancel_requested boolean,
        out_incognito boolean,
        out_user_content text,
        out_user_no_memory boolean,
        out_job_id bigint,
        out_job_status text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    RETURN QUERY
        SELECT g.id, g.conversation_id, c.relationship_id, g.logical_generation_id,
               g.status, g.mode, g.created_at, g.source_user_message_id,
               g.assistant_message_id, g.cancel_requested, c.incognito,
               m.content, COALESCE(m.no_memory, false),
               wi.id, wi.status
          FROM vc.generation g
          JOIN vc.conversation c
            ON c.owner_user_id = g.owner_user_id AND c.id = g.conversation_id
          LEFT JOIN vc.message m
            ON m.owner_user_id = g.owner_user_id AND m.id = g.source_user_message_id
          LEFT JOIN LATERAL (
                SELECT w.id, w.status
                  FROM vc.work_item w
                 WHERE w.owner_user_id = g.owner_user_id
                   AND w.kind = 'GENERATION'
                   AND w.ref_id = g.id
                 ORDER BY w.id
                 LIMIT 1
          ) wi ON true
         WHERE g.owner_user_id = p_owner_user_id
           AND g.id = p_generation_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_read_generation_snapshot(
    p_owner_user_id bigint,
    p_generation_id bigint)
    RETURNS TABLE(
        out_status text,
        out_assistant_message_id bigint,
        out_assistant_content text,
        out_input_tokens bigint,
        out_output_tokens bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    RETURN QUERY
        SELECT g.status,
               g.assistant_message_id,
               am.content,
               att.input_tokens,
               att.output_tokens
          FROM vc.generation g
          LEFT JOIN vc.message am
            ON am.owner_user_id = g.owner_user_id AND am.id = g.assistant_message_id
          LEFT JOIN LATERAL (
                SELECT a.input_tokens, a.output_tokens
                  FROM vc.attempt_intent a
                 WHERE a.owner_user_id = g.owner_user_id
                   AND a.generation_id = g.id
                   AND a.status = 'SUCCEEDED'
                 ORDER BY a.attempt_no DESC NULLS LAST, a.id DESC
                 LIMIT 1
          ) att ON true
         WHERE g.owner_user_id = p_owner_user_id
           AND g.id = p_generation_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_complete_job(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_status text,
    p_error_code text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM vc.go_assert_live_claim(p_owner_user_id, p_work_item_id, p_claim_token, p_claim_fence);
    IF p_status NOT IN ('DONE', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'go_complete_job: unsupported status';
    END IF;
    UPDATE vc.work_item
       SET status = p_status,
           last_error_code = p_error_code,
           finished_at = clock_timestamp(),
           claim_token = NULL,
           claim_fence = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_work_item_id
       AND status = 'CLAIMED'
       AND claim_token = p_claim_token
       AND claim_fence = p_claim_fence;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_purge_expired_opaque_sessions()
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    DELETE FROM vc.identity_opaque_session
     WHERE expires_at <= clock_timestamp()
        OR revoked_at IS NOT NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_list_export_payload(
    p_owner_user_id bigint,
    p_export_id bigint)
    RETURNS TABLE(out_status text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    RETURN QUERY
        SELECT e.status
          FROM vc.export_request e
         WHERE e.owner_user_id = p_owner_user_id AND e.id = p_export_id;
END;
$$;

-- Grants: legacy runtime functions unchanged. Go functions for runtime roles only.
REVOKE ALL ON FUNCTION vc.go_sha256_hex(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_period_ym() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_assert_owner(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_assert_live_claim(bigint, bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_generation_terminal(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_map_attempt_status(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_map_failure_code(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_reserve_cost(bigint, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_close_reservation(bigint, bigint, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_close_job(bigint, bigint, text, text) FROM PUBLIC;

REVOKE ALL ON FUNCTION vc.go_start_turn(bigint, bigint, text, text, text, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_start_turn(bigint, bigint, text, text, text, bigint, integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_promote_claimed_generation(bigint, bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_promote_claimed_generation(bigint, bigint, bigint, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_create_model_attempt(bigint, bigint, bigint, text, text, text, text, text, text[], text, text, text, text, text, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_create_model_attempt(bigint, bigint, bigint, text, text, text, text, text, text[], text, text, text, text, text, bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_record_attempt_outcome(bigint, bigint, bigint, text, text, text, text, text, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_record_attempt_outcome(bigint, bigint, bigint, text, text, text, text, text, bigint, bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_finalize_generation(bigint, bigint, bigint, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_finalize_generation(bigint, bigint, bigint, bigint, text, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_terminalize_generation(bigint, bigint, bigint, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_terminalize_generation(bigint, bigint, bigint, text, text, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_request_cancel(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_request_cancel(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_list_expired_generation_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_expired_generation_jobs(integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_recover_expired_generation(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_recover_expired_generation(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_expire_queued_generations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_expire_queued_generations(integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_get_generation(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_get_generation(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_read_generation_snapshot(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_read_generation_snapshot(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_complete_job(bigint, bigint, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_complete_job(bigint, bigint, text, text, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_purge_expired_opaque_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_purge_expired_opaque_sessions()
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_list_export_payload(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_export_payload(bigint, bigint)
    TO vc_api, vc_worker;

DO $$
BEGIN
    IF has_table_privilege('vc_api', 'vc.go_monthly_cost', 'INSERT')
       OR has_table_privilege('vc_worker', 'vc.go_monthly_cost', 'INSERT') THEN
        RAISE EXCEPTION 'V117: go_monthly_cost must not allow runtime DML';
    END IF;
END;
$$;
