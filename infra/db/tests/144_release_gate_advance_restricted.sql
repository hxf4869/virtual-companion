-- 144_release_gate_advance_restricted: review-fix V93 — the API runtime
-- role must NOT be able to advance the release gate by itself (S0-24-A:
-- "no expansion without eval" is an Owner/operator action). Snapshot reads
-- stay available to vc_api for the admission gate.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_stage text;
BEGIN
    -- Snapshot reads remain executable: admission reads them per intake.
    SELECT out_stage INTO v_stage FROM vc.release_gate_snapshot();
    IF v_stage IS NULL THEN
        RAISE EXCEPTION 'release_gate_snapshot must stay readable by vc_api';
    END IF;

    -- V93: advancing the gate from a runtime role is a privilege error.
    BEGIN
        PERFORM vc.advance_release_gate('BETA', true, 'self-advanced', NULL);
        RAISE EXCEPTION 'vc_api must not be able to advance the release gate';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;  -- expected
        WHEN others THEN
            IF SQLERRM LIKE '%permission denied%' THEN
                NULL;  -- also acceptable wording
            ELSE
                RAISE;
            END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF NOT has_function_privilege('vc_api',
            'vc.release_gate_snapshot()', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api must execute release_gate_snapshot';
    END IF;
    IF has_function_privilege('vc_worker',
            'vc.advance_release_gate(text, boolean, text, bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute advance_release_gate';
    END IF;
    IF has_function_privilege('vc_job_coordinator',
            'vc.advance_release_gate(text, boolean, text, bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_job_coordinator must not execute advance_release_gate';
    END IF;
    IF has_function_privilege('vc_dispatcher',
            'vc.advance_release_gate(text, boolean, text, bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_dispatcher must not execute advance_release_gate';
    END IF;
    IF has_function_privilege('vc_worker',
            'vc.release_gate_snapshot()', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute release_gate_snapshot';
    END IF;
    IF has_function_privilege('vc_job_coordinator',
            'vc.release_gate_snapshot()', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_job_coordinator must not execute release_gate_snapshot';
    END IF;
    IF has_function_privilege('vc_dispatcher',
            'vc.release_gate_snapshot()', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_dispatcher must not execute release_gate_snapshot';
    END IF;
    IF has_table_privilege('vc_api', 'vc.release_gate', 'SELECT') THEN
        RAISE EXCEPTION 'vc_api must not SELECT release_gate directly';
    END IF;
    IF has_table_privilege('vc_worker', 'vc.release_gate', 'SELECT') THEN
        RAISE EXCEPTION 'vc_worker must not SELECT release_gate directly';
    END IF;
    IF has_table_privilege('vc_job_coordinator', 'vc.release_gate', 'SELECT') THEN
        RAISE EXCEPTION 'vc_job_coordinator must not SELECT release_gate directly';
    END IF;
    IF has_table_privilege('vc_dispatcher', 'vc.release_gate', 'SELECT') THEN
        RAISE EXCEPTION 'vc_dispatcher must not SELECT release_gate directly';
    END IF;
END $$;
