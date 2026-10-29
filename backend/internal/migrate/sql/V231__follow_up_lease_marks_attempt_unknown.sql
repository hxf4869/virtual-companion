-- W16 review: an expired follow-up lease whose greeting was not stored
-- keeps the attempt hold as UNKNOWN. The key is
-- follow-up:{job id}:{attempt_count}, plus the unsuffixed legacy key.
-- A stored greeting is left untouched. Requeue and dead-letter both mark.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.go_recover_expired_follow_up(
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

    IF NOT EXISTS (
        SELECT 1 FROM vc.follow_up f
         WHERE f.owner_user_id = p_owner_user_id
           AND f.id = v_ref
           AND f.greeting_body IS NOT NULL
    ) THEN
        PERFORM vc.mark_model_cost_unknown(
            'follow-up:' || p_work_item_id::text || ':' || COALESCE(v_attempts, 0)::text);
        PERFORM vc.mark_model_cost_unknown('follow-up:' || p_work_item_id::text);
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
