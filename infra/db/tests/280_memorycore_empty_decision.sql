-- Empty-publication decision codes stay on the attempt ledger.
-- Direct table updates stay revoked; a cross-owner call cannot write them.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id, display_name) VALUES (28001, 'synthetic empty owner'), (28002, 'synthetic empty other') ON CONFLICT DO NOTHING;
INSERT INTO vc.memory_extract_attempt(owner_user_id, id, work_item_id, st_source_ref, attempt_no, provider_id, supplier_name, model_id, allowed_categories, memorycore_operation_id, memorycore_stage, memorycore_call_sequence)
VALUES (28001, 2800101, 28001, 'synthetic:empty', 1, 'synthetic', 'Synthetic', 'synthetic', ARRAY['MESSAGE_TEXT'], 'op-empty', 'l1-extraction', 1);
INSERT INTO vc.memory_extract_attempt(owner_user_id, id, work_item_id, st_source_ref, attempt_no, provider_id, supplier_name, model_id, allowed_categories, memorycore_operation_id, memorycore_stage, memorycore_call_sequence)
VALUES (28002, 2800201, 28002, 'synthetic:empty-other', 1, 'synthetic', 'Synthetic', 'synthetic', ARRAY['MESSAGE_TEXT'], 'op-empty-other', 'l1-extraction', 1);

BEGIN;
SELECT vc.set_owner_context(28001, 'empty', encode(vc.hmac(convert_to('vc-owner-binding-v1|28001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|empty', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.go_record_memorycore_empty_decision(28001, 28001, 'MEMORYCORE_EMPTY_NO_NEW_FACT');
DO $$ BEGIN
    IF (SELECT decision_code FROM vc.memory_extract_attempt WHERE owner_user_id = 28001 AND id = 2800101) IS DISTINCT FROM 'MEMORYCORE_EMPTY_NO_NEW_FACT' THEN
        RAISE EXCEPTION 'empty decision was not stored';
    END IF;
    BEGIN
        PERFORM vc.go_record_memorycore_empty_decision(28001, 28001, 'secret dialogue');
        RAISE EXCEPTION 'free text decision accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%invalid empty decision%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.go_record_memorycore_empty_decision(28002, 28002, 'MEMORYCORE_EMPTY_DEDUP_MERGED');
        RAISE EXCEPTION 'cross owner decision accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%owner%' THEN RAISE; END IF;
    END;
    BEGIN
        UPDATE vc.memory_extract_attempt SET decision_code = 'MEMORYCORE_EMPTY_DROPPED_GATE' WHERE owner_user_id = 28001;
        RAISE EXCEPTION 'direct decision update accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(28002, 'empty', encode(vc.hmac(convert_to('vc-owner-binding-v1|28002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|empty', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM vc.memory_extract_attempt WHERE owner_user_id = 28001) THEN
        RAISE EXCEPTION 'cross owner attempt leaked';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$ BEGIN
    IF (SELECT decision_code FROM vc.memory_extract_attempt WHERE owner_user_id = 28001 AND id = 2800101) IS DISTINCT FROM 'MEMORYCORE_EMPTY_NO_NEW_FACT' THEN
        RAISE EXCEPTION 'empty decision did not persist';
    END IF;
    IF (SELECT decision_code FROM vc.memory_extract_attempt WHERE owner_user_id = 28002 AND id = 2800201) IS NOT NULL THEN
        RAISE EXCEPTION 'other owner decision changed';
    END IF;
END $$;
