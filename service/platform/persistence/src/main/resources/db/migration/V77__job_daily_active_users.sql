-- V77__job_daily_active_users: METRICS-ALERT (§22.10 / §26.6) — job-style
-- DAU count for the metrics scheduler. Aggregate only: the number of
-- distinct owners with a generation since the given window-day start (no
-- owner identity, no content, §22.11). Follows the retention job-function
-- family (V70): SECURITY DEFINER with no acting account (the scheduler has
-- no HTTP caller), granted to vc_api only.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.job_daily_active_users(p_day_start timestamptz)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_day_start IS NULL THEN
        RAISE EXCEPTION 'job_daily_active_users: day_start is required';
    END IF;

    RETURN (SELECT count(DISTINCT g.owner_user_id)::bigint
              FROM vc.generation g
             WHERE g.created_at >= p_day_start);
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.job_daily_active_users(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.job_daily_active_users(timestamptz) TO vc_api;
