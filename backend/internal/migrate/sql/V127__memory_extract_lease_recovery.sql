-- V127: MEMORY_EXTRACT lease recovery.
--
-- A worker crash (or stop) mid-extraction leaves the MEMORY_EXTRACT work item
-- CLAIMED with an elapsed lease; nothing requeued it, so the turn was silently
-- lost. V117 recovery is generation-specific, so this adds the extraction
-- counterpart used by the loop's RecoverOnce pass:
--   * go_list_expired_memory_extract_jobs — expired CLAIMED MEMORY_EXTRACT jobs.
--   * go_recover_expired_memory_extract   — guarded bounded requeue; when the
--     retry budget is exhausted the job dead-letters (terminal, visible).
-- Requeue resets the claim token/fence/lease (the old claim can no longer
-- complete) and keeps ref_id, so the rerun re-hits the same auto-saved
-- idempotency keys and the same no_memory/consent guards.
-- Mirrors go_list_expired_generation_jobs (V117) for the MEMORY_EXTRACT kind.
CREATE OR REPLACE FUNCTION vc.go_list_expired_memory_extract_jobs(p_limit integer)
    RETURNS TABLE(out_owner_user_id bigint, out_job_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.kind = 'MEMORY_EXTRACT'
           AND wi.status = 'CLAIMED'
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
         ORDER BY wi.lease_expires_at, wi.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
END;
$$;

-- p_max_attempts mirrors the worker's extraction retry budget (the same bound
-- vc.requeue_retryable_failure receives); the caller passes it explicitly.
CREATE OR REPLACE FUNCTION vc.go_recover_expired_memory_extract(
    p_owner_user_id bigint,
    p_work_item_id  bigint,
    p_max_attempts  integer)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind     text;
    v_status   text;
    v_attempts integer;
BEGIN
    IF p_max_attempts IS NULL OR p_max_attempts < 1 THEN
        RAISE EXCEPTION 'go_recover_expired_memory_extract: p_max_attempts must be positive';
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT wi.kind, wi.status, wi.attempt_count
      INTO v_kind, v_status, v_attempts
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
     FOR UPDATE;
    IF NOT FOUND OR v_kind IS DISTINCT FROM 'MEMORY_EXTRACT' THEN
        RAISE EXCEPTION 'go_recover_expired_memory_extract: memory extract job not found';
    END IF;
    IF v_status IS DISTINCT FROM 'CLAIMED' THEN
        RETURN 'IDEMPOTENT_NON_CLAIMED';
    END IF;
    -- Only an elapsed lease may be recovered; a live claim belongs to its owner.
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
               finished_at = clock_timestamp()
         WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;
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

REVOKE ALL ON FUNCTION vc.go_list_expired_memory_extract_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_expired_memory_extract_jobs(integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_recover_expired_memory_extract(bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_recover_expired_memory_extract(bigint, bigint, integer)
    TO vc_api, vc_worker;
