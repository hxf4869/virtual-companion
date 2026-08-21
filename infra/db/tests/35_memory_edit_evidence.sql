-- 35_memory_edit_evidence: the V12 management capabilities -- update_memory
-- (user content edit) and list_memory_evidence (source Evidence read). update_memory
-- only writes summary (status-preserving), accepts PENDING_CONFIRMATION and
-- ACCEPTED, rejects dead-end/deleted/foreign/blank, and is naturally idempotent.
-- list_memory_evidence returns the evidence chain of an owned non-deleted memory
-- and yields no rows for foreign/absent/deleted ids (indistinguishable from a
-- memory with no evidence, so existence is never disclosed).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 11, 'persona-b', false);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'conv');

-- Seed candidates for owner 1: a pending one, an accepted one (each with
-- evidence), a rejected one, and a no-evidence accepted one.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_pend bigint; v_acc bigint; v_rej bigint; v_noop bigint;
BEGIN
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'pend-summary', NULL, ARRAY['ev-1', 'ev-2']) INTO v_pend;
    SELECT vc.create_memory_candidate(1, 11, 'RELATIONSHIP', 'acc-summary',  NULL, ARRAY['ev-3']) INTO v_acc;
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'rej-summary',  NULL, ARRAY[]::text[]) INTO v_rej;
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'noop-summary', NULL, ARRAY[]::text[]) INTO v_noop;
    PERFORM vc.confirm_memory_candidate(1, v_acc);
    PERFORM vc.confirm_memory_candidate(1, v_noop);
    PERFORM vc.reject_memory_candidate(1, v_rej);
    PERFORM set_config('app.pend', v_pend::text, false);
    PERFORM set_config('app.acc',  v_acc::text,  false);
    PERFORM set_config('app.rej',  v_rej::text,  false);
    PERFORM set_config('app.noop', v_noop::text, false);
END $$;
COMMIT;
RESET ROLE;

-- update_memory: status-preserving content edit on PENDING and ACCEPTED.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_ok boolean;
BEGIN
    SELECT vc.update_memory(1, current_setting('app.pend')::bigint, 'pend-edited') INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'update pending must return true'; END IF;
    PERFORM 1 FROM vc.get_memory(1, current_setting('app.pend')::bigint)
     WHERE out_summary = 'pend-edited' AND out_status = 'PENDING_CONFIRMATION';
    IF NOT FOUND THEN RAISE EXCEPTION 'pending edit must change summary, keep status'; END IF;

    SELECT vc.update_memory(1, current_setting('app.acc')::bigint, 'acc-edited') INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'update accepted must return true'; END IF;
    PERFORM 1 FROM vc.get_memory(1, current_setting('app.acc')::bigint)
     WHERE out_summary = 'acc-edited' AND out_status = 'ACCEPTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'accepted edit must change summary, keep ACCEPTED'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- update_memory: rejected status, blank summary and a foreign/absent id all fail
-- closed without disclosing existence.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.update_memory(1, current_setting('app.rej')::bigint, 'rej-edited');
        RAISE EXCEPTION 'editing a REJECTED memory must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%editing a REJECTED memory must fail%' THEN
            RAISE;
        END IF;
        -- expected: non-editable status
    END;
    BEGIN
        PERFORM vc.update_memory(1, current_setting('app.pend')::bigint, '   ');
        RAISE EXCEPTION 'blank summary must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%blank summary must fail%' THEN
            RAISE;
        END IF;
        -- expected: summary required
    END;
    BEGIN
        PERFORM vc.update_memory(1, 999999, 'ghost');
        RAISE EXCEPTION 'absent id must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%absent id must fail%' THEN
            RAISE;
        END IF;
        -- expected: not found (existence hidden)
    END;
END $$;
COMMIT;
RESET ROLE;

-- update_memory on a soft-deleted memory fails; list_memory_evidence returns no
-- rows for it.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_ok boolean; n int;
BEGIN
    PERFORM vc.delete_memory(1, current_setting('app.acc')::bigint);
    BEGIN
        PERFORM vc.update_memory(1, current_setting('app.acc')::bigint, 'after-delete');
        RAISE EXCEPTION 'editing a deleted memory must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%editing a deleted memory must fail%' THEN
            RAISE;
        END IF;
        -- expected: deleted
    END;
    SELECT count(*) INTO n FROM vc.list_memory_evidence(1, current_setting('app.acc')::bigint);
    IF n <> 0 THEN RAISE EXCEPTION 'evidence of a deleted memory must not be returned, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Cross-owner isolation (owner 2): update and evidence-read on owner 1's memory
-- fail / return empty and never disclose existence.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    BEGIN
        PERFORM vc.update_memory(2, current_setting('app.pend')::bigint, 'hijack');
        RAISE EXCEPTION 'cross-owner update must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cross-owner update must fail%' THEN
            RAISE;
        END IF;
        -- expected: not found (existence hidden)
    END;
    SELECT count(*) INTO n FROM vc.list_memory_evidence(2, current_setting('app.pend')::bigint);
    IF n <> 0 THEN RAISE EXCEPTION 'cross-owner evidence read must return 0, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_memory_evidence(2, 999999);
    IF n <> 0 THEN RAISE EXCEPTION 'absent evidence read must return 0'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- list_memory_evidence: returns the ordered evidence chain for an owned live
-- memory; a no-evidence memory returns 0 (indistinguishable from foreign).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.list_memory_evidence(1, current_setting('app.pend')::bigint);
    IF n <> 2 THEN RAISE EXCEPTION 'pending memory must have 2 evidence rows, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_memory_evidence(1, current_setting('app.noop')::bigint);
    IF n <> 0 THEN RAISE EXCEPTION 'no-evidence memory must return 0, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Evidence chain (superuser): list_memory_evidence is the only vc_api path to
-- memory_evidence rows; confirm the ordered sources match what create wrote.
DO $$
DECLARE ref text;
BEGIN
    -- V17: list_memory_evidence requires server-trusted owner context (P1-04).
    PERFORM vc.set_owner_context(1, 'n7', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n7', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT out_source_ref INTO ref FROM vc.list_memory_evidence(1, current_setting('app.pend')::bigint)
     ORDER BY out_id LIMIT 1;
    IF ref IS DISTINCT FROM 'ev-1' THEN RAISE EXCEPTION 'first evidence source must be ev-1, got %', ref; END IF;
END $$;
