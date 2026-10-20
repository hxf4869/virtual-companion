-- V135: DATA_EXPORT lease recovery.
--
-- A worker crash (or stop) mid-export leaves the DATA_EXPORT work item
-- CLAIMED with an elapsed lease while the export_request stays PENDING.
-- Nothing picks that state up: go_claim_jobs only claims PENDING rows, the
-- V117/V127-style recovery passes cover GENERATION and MEMORY_EXTRACT only,
-- and the R05 failure close goes through go_complete_job, whose live-claim
-- assert refuses an elapsed lease — so the owner stays blocked behind
-- count_inflight_exports. This adds the export entry used by the loop's
-- RecoverOnce pass:
--   * go_list_expired_export_jobs — expired CLAIMED DATA_EXPORT jobs.
--   * go_recover_expired_export   — terminal close, no requeue: the work
--     item fails with EXPORT_LEASE_EXPIRED and vc.fail_export moves a
--     still-PENDING export to FAILED in the same transaction. Export builds
--     are not re-run automatically (the owner can simply request a new
--     export once unblocked), and fail_export affecting 0 rows is not an
--     error — an already-READY or terminal export never regresses while
--     the work item still closes. A live claim is never touched.
-- Mirrors go_recover_expired_memory_extract (V127) for the DATA_EXPORT kind.
CREATE OR REPLACE FUNCTION vc.go_list_expired_export_jobs(p_limit integer)
    RETURNS TABLE(out_owner_user_id bigint, out_job_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.kind = 'DATA_EXPORT'
           AND wi.status = 'CLAIMED'
           AND wi.lease_expires_at IS NOT NULL
           AND wi.lease_expires_at <= clock_timestamp()
         ORDER BY wi.lease_expires_at, wi.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
END;
$$;

-- Terminal recovery: close the expired CLAIMED work item as FAILED and fail
-- the still-PENDING export atomically. The single-transaction shape mirrors
-- R05's FailExportJob — a fail_export exception rolls the work item close
-- back with it. ref_id is NOT NULL and enqueue always passes the export id,
-- so no NULL ref branch exists.
CREATE OR REPLACE FUNCTION vc.go_recover_expired_export(
    p_owner_user_id bigint,
    p_work_item_id  bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind   text;
    v_ref    bigint;
    v_status text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);

    SELECT wi.kind, wi.ref_id, wi.status
      INTO v_kind, v_ref, v_status
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id AND wi.id = p_work_item_id
     FOR UPDATE;
    IF NOT FOUND OR v_kind IS DISTINCT FROM 'DATA_EXPORT' THEN
        RAISE EXCEPTION 'go_recover_expired_export: export job not found';
    END IF;
    IF v_status IS DISTINCT FROM 'CLAIMED' THEN
        RETURN 'IDEMPOTENT_NON_CLAIMED';
    END IF;
    -- Only an elapsed lease may be recovered; a live claim belongs to its
    -- holder (the listing may have raced a fresh claim by a new worker).
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

    UPDATE vc.work_item
       SET status = 'FAILED',
           last_error_code = 'EXPORT_LEASE_EXPIRED',
           finished_at = clock_timestamp(),
           claim_token = NULL,
           claim_fence = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner_user_id AND id = p_work_item_id;

    -- fail_export affecting 0 rows is not an error: a READY/terminal or
    -- missing export never regresses, the work item still closes.
    PERFORM vc.fail_export(p_owner_user_id, v_ref, 'EXPORT_LEASE_EXPIRED');
    RETURN 'FAILED';
END;
$$;

REVOKE ALL ON FUNCTION vc.go_list_expired_export_jobs(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_expired_export_jobs(integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_recover_expired_export(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_recover_expired_export(bigint, bigint)
    TO vc_api, vc_worker;
