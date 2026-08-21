-- 12_coordinator_reads_only_metadata: vc_job_coordinator can read opaque work
-- item metadata but NOT the payload column (column-level privilege isolation).

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload)
VALUES (1, 1, 'GENERATION', 10, decode('aabbcc', 'hex'));

-- SET ROLE vc_job_coordinator;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_job_coordinator;
-- Coordinator can read opaque metadata.
DO $$
DECLARE k text; r bigint;
BEGIN
    SELECT kind, ref_id INTO k, r FROM vc.work_item WHERE id = 1;
    IF k IS NULL OR k <> 'GENERATION' THEN
        RAISE EXCEPTION 'coordinator cannot read metadata kind (got %)', k;
    END IF;
    IF r IS NULL OR r <> 10 THEN
        RAISE EXCEPTION 'coordinator cannot read metadata ref_id (got %)', r;
    END IF;
END $$;
-- Coordinator CANNOT read the payload column.
DO $$
BEGIN
    PERFORM payload FROM vc.work_item WHERE id = 1;
    RAISE EXCEPTION 'coordinator unexpectedly read work item payload';
EXCEPTION
    WHEN insufficient_privilege OR others THEN
        IF SQLERRM LIKE '%coordinator unexpectedly read work item payload%' THEN
            RAISE;
        END IF;
        IF sqlerrm NOT LIKE '%permission%' AND sqlerrm NOT LIKE '%payload%' THEN
            RAISE;
        END IF;
END $$;
-- Coordinator CANNOT call claim_work_items either (EXECUTE revoked from PUBLIC;
-- the function return signature includes payload, so calling it would leak it).
DO $$
BEGIN
    PERFORM * FROM vc.claim_work_items(1, 'FENCE', 30, 16);
    RAISE EXCEPTION 'coordinator unexpectedly executed claim_work_items';
EXCEPTION
    WHEN insufficient_privilege OR others THEN
        IF SQLERRM LIKE '%coordinator unexpectedly executed claim_work_items%' THEN
            RAISE;
        END IF;
        IF sqlerrm NOT LIKE '%permission%' AND sqlerrm NOT LIKE '%execute%' THEN
            RAISE;
        END IF;
END $$;
COMMIT;
RESET ROLE;
