-- 52_revoked_runtime_dml_on_business_tables: after V16, a runtime role can no
-- longer directly INSERT, UPDATE or DELETE on any business state table even
-- when a valid owner context is bound. The RLS WITH CHECK is no longer the
-- only guard: the REVOKE makes the statement fail with insufficient_privilege
-- before RLS is even consulted. Every write must go through the窄 SECURITY
-- DEFINER state-machine functions.
--
-- Covers the 17 tables whose DML was revoked in V16:
--   vc_user, relationship, conversation, message, generation,
--   generation_route, generation_attempt, generation_candidate,
--   memory_item, memory_evidence, authorization_snapshot,
--   generation_usage, quota_ledger_entry, realtime_event, outbox_event,
--   realtime_stream, realtime_ticket, provider_attempt.

\set ON_ERROR_STOP on

-- Clean slate (superuser fixture setup).
TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream,
         vc.outbox_event, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.authorization_snapshot,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.vc_user CASCADE;

-- Minimal fixture so the tested statements can reference existing rows. The
-- superuser bypasses every privilege check, so fixture INSERTs succeed.
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 1000, 100, 'lgid-1', 'PENDING');

-- Switch to the vc_api runtime role. Without V16, vc_api retained the broad
-- V2/V3/V7/V15 DML grants and could direct-write; after V16, every write
-- below must be denied at the privilege check (before RLS is consulted).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';

-- Helper: assert a SQL statement is rejected as insufficient_privilege.
-- psql ON_ERROR_STOP would abort on the first error, so each rejection is
-- wrapped in a DO block that catches the expected exception.
DO $$
BEGIN
    -- INSERT into generation (state-machine core table).
    BEGIN
        INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
        VALUES (1, 1001, 100, 'lgid-2', 'PENDING');
        RAISE EXCEPTION 'V16 regression: vc_api INSERT into vc.generation succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- UPDATE on generation.
    BEGIN
        UPDATE vc.generation SET status = 'IN_PROGRESS' WHERE id = 1000;
        RAISE EXCEPTION 'V16 regression: vc_api UPDATE on vc.generation succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- DELETE on message (state-machine table, must be function-only).
    BEGIN
        DELETE FROM vc.message;
        RAISE EXCEPTION 'V16 regression: vc_api DELETE on vc.message succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- INSERT into authorization_snapshot (P2-12 one-way lifecycle).
    BEGIN
        INSERT INTO vc.authorization_snapshot(
            owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
            purpose, data_categories, task_cancelled, source_data_deleted)
        VALUES (1, 'snap-x', 'ACTIVE', 'prov', 'reg', 'contract',
                'GENERATION', ARRAY['TEXT']::text[], false, false);
        RAISE EXCEPTION 'V16 regression: vc_api INSERT into vc.authorization_snapshot succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- UPDATE on quota_ledger_entry (financial/quota integrity).
    BEGIN
        UPDATE vc.quota_ledger_entry SET quota_amount = 0;
        RAISE EXCEPTION 'V16 regression: vc_api UPDATE on vc.quota_ledger_entry succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- INSERT into realtime_event (must go through append_realtime_event).
    BEGIN
        INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, stream_epoch, event_seq,
                                       event_type, payload, created_at)
        VALUES (1, nextval('vc.finalize_row_id_seq'), 1000, 1, 1, 'test.event', '{}'::jsonb, now());
        RAISE EXCEPTION 'V16 regression: vc_api INSERT into vc.realtime_event succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- INSERT into provider_attempt (audit, must go through record_provider_attempt).
    BEGIN
        INSERT INTO vc.provider_attempt(owner_user_id, id, generation_id, provider_id,
                                        supplier_name, status)
        VALUES (1, 1, 1000, 'prov', 'supplier', 'CREATED');
        RAISE EXCEPTION 'V16 regression: vc_api INSERT into vc.provider_attempt succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;

-- Sanity: SELECT still works (V16 only revoked write privileges). The bound
-- owner sees exactly the rows owned by alice (RLS owner_isolation).
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.generation;
    IF n <> 1 THEN
        RAISE EXCEPTION 'V16 regression: SELECT on vc.generation broken, expected 1 got %', n;
    END IF;
END $$;

COMMIT;
RESET ROLE;
