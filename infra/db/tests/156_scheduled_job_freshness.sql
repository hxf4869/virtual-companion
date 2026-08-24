-- 156_scheduled_job_freshness: S0-31 last-success/read model contains only
-- fixed scheduler metadata and distinguishes successful, failed and in-flight runs.

\set ON_ERROR_STOP on

TRUNCATE vc.job_run;
UPDATE vc.job_lease
   SET holder = NULL, fence = NULL, expires_at = NULL,
       paused = false, dry_run = false;

DO $$
DECLARE ok_run bigint; failed_run bigint; started_run bigint;
BEGIN
    ok_run := vc.start_job_run('DAU_METRICS');
    IF NOT vc.finish_job_run(ok_run, 'SUCCEEDED', '{"dau":7}'::jsonb, '') THEN
        RAISE EXCEPTION 'successful run did not finish';
    END IF;
    failed_run := vc.start_job_run('AUTH_EVENT_PURGE');
    IF NOT vc.finish_job_run(failed_run, 'FAILED', '{}'::jsonb, 'purge_failed') THEN
        RAISE EXCEPTION 'failed run did not finish';
    END IF;
    started_run := vc.start_job_run('EXPORT_EXPIRY');
    IF started_run IS NULL THEN RAISE EXCEPTION 'started run missing'; END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE h record; seen integer := 0;
BEGIN
    FOR h IN SELECT * FROM vc.list_job_health() LOOP
        seen := seen + 1;
        IF h.out_job_name = 'DAU_METRICS' THEN
            IF h.out_last_success_at IS NULL OR h.out_latest_status <> 'SUCCEEDED' THEN
                RAISE EXCEPTION 'DAU success freshness missing';
            END IF;
        ELSIF h.out_job_name = 'AUTH_EVENT_PURGE' THEN
            IF h.out_last_success_at IS NOT NULL OR h.out_latest_status <> 'FAILED'
               OR h.out_latest_finished_at IS NULL THEN
                RAISE EXCEPTION 'failed run health shape invalid';
            END IF;
        ELSIF h.out_job_name = 'EXPORT_EXPIRY' THEN
            IF h.out_latest_status <> 'STARTED' OR h.out_latest_finished_at IS NOT NULL THEN
                RAISE EXCEPTION 'in-flight run health shape invalid';
            END IF;
        ELSIF h.out_job_name = 'RETENTION_PURGE' THEN
            IF h.out_latest_status IS NOT NULL OR h.out_last_success_at IS NOT NULL THEN
                RAISE EXCEPTION 'never-run job must have null freshness';
            END IF;
        ELSE
            RAISE EXCEPTION 'unexpected job name %', h.out_job_name;
        END IF;
    END LOOP;
    IF seen <> 4 THEN RAISE EXCEPTION 'expected four fixed jobs, got %', seen; END IF;
END $$;
COMMIT;
RESET ROLE;
