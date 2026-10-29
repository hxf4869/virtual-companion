-- W16-1: restart recovery for an expired FOLLOW_UP claim, and a sweep of
-- model-cost holds left HELD when the caller is killed.
--
-- FOLLOW_UP claims are PENDING-only, and V167's partial unique index admits
-- one PENDING or CLAIMED row. An elapsed CLAIMED lease therefore stuck the
-- follow-up forever. Recovery requeues that same job (the greeting attempt
-- key is follow-up:{job id}) until the attempt cap, then dead-letters it.
-- A follow-up that never stored a terminal greeting is set SILENT so the due
-- pass cannot enqueue a replacement in the same tick. A stored greeting is
-- left in place. Claim also accepts a live job whose follow-up is already
-- terminal, so the handler can finish the job without generating again.
--
-- sweep_expired_model_cost_holds marks HELD rows older than the caller's
-- bound as UNKNOWN via mark_model_cost_unknown. The bound is computed in Go
-- from the foreground, tool and memory call limits plus the existing lease
-- margin; this function does not choose the timeout. The priced hold moves
-- from reserved to unsettled and is not released as zero.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.go_list_expired_follow_up_jobs(p_limit integer)
    RETURNS TABLE(out_owner_user_id bigint, out_job_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.kind = 'FOLLOW_UP'
           AND wi.status = 'CLAIMED'
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
         ORDER BY wi.lease_expires_at, wi.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
END;
$$;

CREATE FUNCTION vc.go_recover_expired_follow_up(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_max_attempts integer)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind text;
    v_status text;
    v_attempts integer;
    v_ref bigint;
BEGIN
    IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
        RAISE EXCEPTION 'go_recover_expired_follow_up: p_max_attempts must be positive';
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT wi.kind, wi.status, wi.attempt_count, wi.ref_id
      INTO v_kind, v_status, v_attempts, v_ref
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
     FOR UPDATE;
    IF NOT FOUND OR v_kind IS DISTINCT FROM 'FOLLOW_UP' THEN
        RAISE EXCEPTION 'go_recover_expired_follow_up: follow-up job not found';
    END IF;
    IF v_status IS DISTINCT FROM 'CLAIMED' THEN
        RETURN 'IDEMPOTENT_NON_CLAIMED';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM vc.work_item wi
         WHERE wi.owner_user_id = p_owner_user_id
           AND wi.id = p_work_item_id
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
    ) THEN
        RETURN 'LEASE_ACTIVE';
    END IF;

    IF v_attempts + 1 >= p_max_attempts THEN
        UPDATE vc.work_item
           SET status = 'DEAD_LETTERED',
               attempt_count = attempt_count + 1,
               finished_at = clock_timestamp(),
               last_error_code = 'FOLLOW_UP_LEASE_EXHAUSTED',
               claim_token = NULL,
               claim_fence = NULL,
               claimed_at = NULL,
               lease_expires_at = NULL
         WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
        -- No stored greeting: stop the due pass from inserting another live job.
        -- A terminal greeting (already generated or already host-waiting) stays.
        UPDATE vc.follow_up
           SET status = 'SILENT',
               trigger_at = NULL,
               deferred_until = NULL,
               generation_reason = COALESCE(generation_reason, 'LEASE_EXHAUSTED')
         WHERE owner_user_id = p_owner_user_id
           AND id = v_ref
           AND status IN ('SCHEDULED', 'DEFERRED')
           AND (
                generation_outcome IS NULL
                OR generation_outcome NOT IN (
                    'BODY_READY', 'WAITING_HOST', 'BLOCKED', 'CANCELLED', 'SOURCE_INVALID'));
        RETURN 'DEAD_LETTERED';
    END IF;

    UPDATE vc.work_item
       SET status = 'PENDING',
           attempt_count = attempt_count + 1,
           next_attempt_at = NULL,
           claim_token = NULL,
           claim_fence = NULL,
           claimed_at = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
    RETURN 'REQUEUED';
END;
$$;

REVOKE ALL ON FUNCTION vc.go_list_expired_follow_up_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_expired_follow_up_jobs(integer) TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_recover_expired_follow_up(bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_recover_expired_follow_up(bigint, bigint, integer) TO vc_api, vc_worker;

CREATE OR REPLACE FUNCTION vc.go_claim_jobs(
    p_generation_lease_seconds integer,
    p_export_lease_seconds integer,
    p_default_lease_seconds integer,
    p_limit integer,
    p_generation_limit integer,
    p_extract_limit integer)
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
    v_gen_limit integer;
    v_extract_limit integer;
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
    v_gen_limit := CASE
        WHEN p_generation_limit IS NULL THEN NULL
        ELSE GREATEST(p_generation_limit, 0)
    END;
    v_extract_limit := CASE
        WHEN p_extract_limit IS NULL THEN NULL
        ELSE GREATEST(p_extract_limit, 0)
    END;

    RETURN QUERY
    WITH gen_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'GENERATION'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_gen_limit
    ),
    export_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'DATA_EXPORT'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ),
    extract_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'ST_MEMORY_EXTRACT'
           AND (EXISTS (SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id = wi.owner_user_id AND s.id = wi.ref_id AND s.settled))
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_extract_limit
    ),
    follow_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'FOLLOW_UP'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
           AND EXISTS (
               SELECT 1 FROM vc.follow_up f
                WHERE f.owner_user_id = wi.owner_user_id
                  AND f.id = wi.ref_id
                  AND (
                       (f.status = 'SCHEDULED' AND f.trigger_at IS NOT NULL)
                       OR f.status IN ('BODY_READY', 'WAITING_HOST', 'CANCELLED')
                       OR (
                           f.status IN ('DEFERRED', 'SILENT')
                           AND f.generation_outcome IN (
                               'NOT_GENERATED', 'POLICY_DISABLED', 'BLOCKED'))))
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ),
    picked AS (
        SELECT owner_user_id, id
          FROM (
              SELECT * FROM gen_picked
              UNION ALL SELECT * FROM export_picked
              UNION ALL SELECT * FROM extract_picked
              UNION ALL SELECT * FROM follow_picked
          ) u
         ORDER BY created_at, id
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
                   WHEN 'FOLLOW_UP' THEN p_default_lease_seconds
                   ELSE p_default_lease_seconds
               END)
      FROM picked p
     WHERE wi.owner_user_id = p.owner_user_id AND wi.id = p.id
    RETURNING wi.owner_user_id, wi.id, wi.kind, wi.ref_id, wi.claim_token, wi.claim_fence,
              CASE wi.kind
                  WHEN 'GENERATION' THEN p_generation_lease_seconds
                  WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                  WHEN 'FOLLOW_UP' THEN p_default_lease_seconds
                  ELSE p_default_lease_seconds
              END;
END;
$$;

CREATE FUNCTION vc.sweep_expired_model_cost_holds(p_older_than_seconds integer)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_attempt text;
    v_count integer := 0;
BEGIN
    IF p_older_than_seconds IS NULL OR p_older_than_seconds < 1 THEN
        RAISE EXCEPTION 'sweep_expired_model_cost_holds: p_older_than_seconds must be positive';
    END IF;
    FOR v_attempt IN
        SELECT r.provider_attempt_id
          FROM vc.model_cost_reservation r
         WHERE r.status = 'HELD'
           AND r.created_at <= clock_timestamp() - make_interval(secs => p_older_than_seconds)
         ORDER BY r.id
         FOR UPDATE
    LOOP
        PERFORM vc.mark_model_cost_unknown(v_attempt);
        v_count := v_count + 1;
    END LOOP;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION vc.sweep_expired_model_cost_holds(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.sweep_expired_model_cost_holds(integer) TO vc_api, vc_worker;

CREATE OR REPLACE FUNCTION vc.settle_model_usage_reservation(
    p_owner bigint,
    p_reservation_id bigint,
    p_input bigint,
    p_output bigint)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_purpose text,
        out_status text,
        out_actual_usd text,
        out_input_tokens bigint,
        out_output_tokens bigint,
        out_idempotent boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
    v_actual numeric(18,6);
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    IF p_reservation_id IS NULL OR p_input IS NULL OR p_input < 0
       OR p_output IS NULL OR p_output < 0 THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    SELECT * INTO v_row FROM vc.model_cost_reservation
     WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND OR v_row.owner_user_id IS DISTINCT FROM p_owner
       OR v_row.purpose NOT IN ('FOREGROUND_CHAT', 'TOOL_TURN') THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF v_row.status = 'SETTLED' THEN
        RETURN QUERY SELECT v_row.id, v_row.purpose, v_row.status,
            to_char(v_row.actual_usd, 'FM999999999999990.000000'),
            v_row.actual_input_tokens, v_row.actual_output_tokens, true;
        RETURN;
    END IF;
    IF v_row.status = 'UNKNOWN' THEN
        -- Late settlement after a crash or the hold sweep. Matches
        -- REUSED_UNKNOWN: stay UNKNOWN, keep actual NULL, do not move money
        -- and do not book the late token counts.
        RETURN QUERY SELECT v_row.id, v_row.purpose, v_row.status,
            NULL::text, NULL::bigint, NULL::bigint, true;
        RETURN;
    END IF;
    IF v_row.status <> 'HELD' THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    PERFORM 1 FROM vc.month_cost_budget
     WHERE month_start = v_row.month_start FOR UPDATE;
    v_actual := round((p_input * v_row.input_usd_per_1k
                     + p_output * v_row.output_usd_per_1k) / 1000, 6);
    UPDATE vc.month_cost_budget
       SET reserved_usd = greatest(0, reserved_usd - v_row.reserved_usd),
           settled_usd = settled_usd + v_actual
     WHERE month_start = v_row.month_start;
    UPDATE vc.model_cost_reservation
       SET status = 'SETTLED',
           actual_input_tokens = p_input,
           actual_output_tokens = p_output,
           actual_usd = v_actual,
           settled_at = clock_timestamp()
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_row.id, v_row.purpose, 'SETTLED'::text,
        to_char(v_actual, 'FM999999999999990.000000'), p_input, p_output, false;
END;
$$;
