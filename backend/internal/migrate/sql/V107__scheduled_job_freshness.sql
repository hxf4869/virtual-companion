-- S0-31 completion: stable scheduler freshness read model. It exposes only
-- fixed job names/status/timestamps (never owner identity or user content).

SET search_path TO vc, pg_catalog;

CREATE INDEX IF NOT EXISTS job_run_job_finished_idx
    ON vc.job_run(job_name, finished_at DESC, id DESC);

CREATE FUNCTION vc.list_job_health()
    RETURNS TABLE(
        out_job_name text,
        out_paused boolean,
        out_dry_run boolean,
        out_last_success_at timestamptz,
        out_latest_status text,
        out_latest_started_at timestamptz,
        out_latest_finished_at timestamptz)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT l.job_name,
           l.paused,
           l.dry_run,
           succeeded.finished_at,
           latest.status,
           latest.started_at,
           latest.finished_at
      FROM vc.job_lease l
      LEFT JOIN LATERAL (
          SELECT r.finished_at
            FROM vc.job_run r
           WHERE r.job_name = l.job_name
             AND r.status IN ('SUCCEEDED', 'DRY_RUN')
             AND r.finished_at IS NOT NULL
           ORDER BY r.finished_at DESC, r.id DESC
           LIMIT 1
      ) succeeded ON true
      LEFT JOIN LATERAL (
          SELECT r.status, r.started_at, r.finished_at
            FROM vc.job_run r
           WHERE r.job_name = l.job_name
           ORDER BY r.started_at DESC, r.id DESC
           LIMIT 1
      ) latest ON true
     ORDER BY l.job_name;
$$;

REVOKE ALL ON FUNCTION vc.list_job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_job_health()
    TO vc_api, vc_worker, vc_job_coordinator;
