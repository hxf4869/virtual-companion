-- 137_job_lease_run_history: S0-31-B V86 — two holders cannot both acquire
-- an unexpired lease; pause fails closed; dry-run is visible; run history
-- records start/finish; runtime roles have no table DML.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_acquired boolean;
    v_paused boolean;
    v_dry boolean;
    v_run bigint;
    v_done boolean;
    v_n integer;
BEGIN
    SELECT out_acquired, out_paused, out_dry_run
      INTO v_acquired, v_paused, v_dry
      FROM vc.try_acquire_job_lease('RETENTION_PURGE', 'holder-a', 60);
    IF v_acquired IS NOT TRUE OR v_paused IS NOT FALSE OR v_dry IS NOT FALSE THEN
        RAISE EXCEPTION 'first holder must acquire, got % % %', v_acquired, v_paused, v_dry;
    END IF;

    SELECT out_acquired INTO v_acquired
      FROM vc.try_acquire_job_lease('RETENTION_PURGE', 'holder-b', 60);
    IF v_acquired IS NOT FALSE THEN
        RAISE EXCEPTION 'second holder must not acquire a live lease';
    END IF;

    SELECT out_acquired INTO v_acquired
      FROM vc.try_acquire_job_lease('RETENTION_PURGE', 'holder-a', 60);
    IF v_acquired IS NOT TRUE THEN
        RAISE EXCEPTION 'same holder may renew';
    END IF;

    v_run := vc.start_job_run('RETENTION_PURGE');
    IF v_run IS NULL OR v_run <= 0 THEN
        RAISE EXCEPTION 'start_job_run must return id';
    END IF;
    v_done := vc.finish_job_run(v_run, 'SUCCEEDED', '{"NORMAL_CHAT":1}'::jsonb, NULL);
    IF v_done IS NOT TRUE THEN
        RAISE EXCEPTION 'finish_job_run must succeed';
    END IF;

    BEGIN
        INSERT INTO vc.job_run(job_name, status) VALUES ('DAU_METRICS', 'STARTED');
        RAISE EXCEPTION 'direct INSERT on job_run must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.job_lease SET paused = true, holder = NULL, expires_at = NULL
 WHERE job_name = 'DAU_METRICS';
UPDATE vc.job_lease SET dry_run = true, holder = NULL, expires_at = NULL
 WHERE job_name = 'EXPORT_EXPIRY';

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_acquired boolean;
    v_paused boolean;
    v_dry boolean;
BEGIN
    SELECT out_acquired, out_paused INTO v_acquired, v_paused
      FROM vc.try_acquire_job_lease('DAU_METRICS', 'holder-c', 60);
    IF v_acquired IS NOT FALSE OR v_paused IS NOT TRUE THEN
        RAISE EXCEPTION 'paused job must fail closed, got % %', v_acquired, v_paused;
    END IF;

    SELECT out_acquired, out_dry_run INTO v_acquired, v_dry
      FROM vc.try_acquire_job_lease('EXPORT_EXPIRY', 'holder-c', 60);
    IF v_acquired IS NOT TRUE OR v_dry IS NOT TRUE THEN
        RAISE EXCEPTION 'dry-run job must still acquire with dry_run, got % %', v_acquired, v_dry;
    END IF;
END $$;
COMMIT;
RESET ROLE;
