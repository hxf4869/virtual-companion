-- V129: per-kind claim capacity for go_claim_jobs.
--
-- Codex audit finding 4: the loop's claim budget was the SUM of free
-- generation and extract slots, and the claim itself was kind-blind. With one
-- generation slot and one extract slot, a blocked extraction kept the extract
-- slot busy while the free generation slot kept authorising claims; each round
-- could claim another MEMORY_EXTRACT job that then parked in a waiting
-- goroutine holding a claim+lease. Expired parked leases were requeued by the
-- V127 recovery while the old holder still waited, so the same job could run
-- twice.
--
-- Fix contract (worker side lands with this migration):
--   * The claim is per kind: GENERATION and MEMORY_EXTRACT are each capped by
--     the worker's free slots for that kind (p_generation_limit /
--     p_extract_limit). DATA_EXPORT keeps the overall batch cap (it has no
--     dedicated worker slots).
--   * The worker takes the slot at claim time, so a claimed job is always
--     inside capacity: claimed-per-round <= slots of that kind and no
--     claimed-but-waiting goroutines exist. Chat and extraction stay mutually
--     independent: a full pool of one kind never blocks claiming the other.
--   * NULL per-kind limit keeps the old unbounded-within-batch behaviour for
--     any caller that does not pass capacity; 0 claims none.
--
-- Signature change: the V117/V125 4-argument go_claim_jobs is replaced by the
-- 6-argument form below and the old overload is dropped. The only caller is
-- the Go worker (updated in the same change set).
SET search_path TO vc, pg_catalog;

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
           AND wi.kind = 'MEMORY_EXTRACT'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_extract_limit
    ),
    picked AS (
        SELECT owner_user_id, id
          FROM (
              SELECT * FROM gen_picked
              UNION ALL SELECT * FROM export_picked
              UNION ALL SELECT * FROM extract_picked
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

DROP FUNCTION IF EXISTS vc.go_claim_jobs(integer, integer, integer, integer);

REVOKE ALL ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer, integer, integer)
    TO vc_api, vc_worker;
