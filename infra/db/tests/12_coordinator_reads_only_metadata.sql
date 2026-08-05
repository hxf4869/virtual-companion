-- 12_coordinator_reads_only_metadata: vc_job_coordinator can read opaque work
-- item metadata but NOT the payload column (column-level privilege isolation).

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, payload)
VALUES (1, 1, 'GENERATION', 10, decode('aabbcc', 'hex'));

SET ROLE vc_job_coordinator;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
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
        IF sqlerrm NOT LIKE '%permission%' AND sqlerrm NOT LIKE '%payload%' THEN
            RAISE;
        END IF;
END $$;
COMMIT;
RESET ROLE;
