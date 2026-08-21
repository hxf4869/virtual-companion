-- 30_generation_cancel: cancel_generation moves a cancellable non-terminal
-- generation to CANCELLED via the catalog double-hop (non-terminal ->
-- CANCEL_REQUESTED -> CANCELLED). Terminal states and COMMITTING (no cancel edge
-- in the catalog) are rejected. A foreign or absent id raises and never discloses
-- existence (NOT_FOUND_OR_FORBIDDEN).

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (2, 200, 20, 'bob-conv');

-- Generations seeded in specific states directly (status is free-text policy;
-- the catalog governs transitions, not a DB CHECK). Owner 1 holds a cancellable
-- IN_PROGRESS, a terminal COMPLETED, and a non-cancellable COMMITTING. Owner 2
-- holds a foreign IN_PROGRESS.
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 1000, 100, 'gen-cancel', 'IN_PROGRESS');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 1001, 100, 'gen-done', 'COMPLETED');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 1002, 100, 'gen-committing', 'COMMITTING');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (2, 2000, 200, 'gen-bob', 'IN_PROGRESS');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_out text;
    n     int;
BEGIN
    -- Happy path: a cancellable IN_PROGRESS generation becomes CANCELLED.
    SELECT vc.cancel_generation(1, 1000) INTO v_out;
    IF v_out <> 'CANCELLED' THEN
        RAISE EXCEPTION 'cancel must return CANCELLED, got %', v_out;
    END IF;
    SELECT count(*) INTO n FROM vc.generation
     WHERE owner_user_id = 1 AND id = 1000 AND status = 'CANCELLED';
    IF n <> 1 THEN RAISE EXCEPTION 'generation 1000 must be CANCELLED after cancel'; END IF;

    -- Re-cancelling an already-terminal (CANCELLED) generation must fail.
    BEGIN
        PERFORM vc.cancel_generation(1, 1000);
        RAISE EXCEPTION 're-cancelling a CANCELLED generation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%re-cancelling a CANCELLED generation must fail%' THEN
            RAISE;
        END IF;
        -- expected: not cancellable
    END;

    -- A terminal COMPLETED generation cannot be cancelled.
    BEGIN
        PERFORM vc.cancel_generation(1, 1001);
        RAISE EXCEPTION 'cancelling a COMPLETED generation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cancelling a COMPLETED generation must fail%' THEN
            RAISE;
        END IF;
        -- expected: not cancellable
    END;

    -- COMMITTING has no CANCEL_REQUESTED edge in the catalog; not cancellable.
    BEGIN
        PERFORM vc.cancel_generation(1, 1002);
        RAISE EXCEPTION 'cancelling a COMMITTING generation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cancelling a COMMITTING generation must fail%' THEN
            RAISE;
        END IF;
        -- expected: not cancellable
    END;
END $$;
COMMIT;
RESET ROLE;

-- Cross-owner and absent ids raise without disclosing existence.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    -- Foreign generation (owner 2's id 2000) must raise, not cancel.
    BEGIN
        PERFORM vc.cancel_generation(1, 2000);
        RAISE EXCEPTION 'cancelling a foreign generation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cancelling a foreign generation must fail%' THEN
            RAISE;
        END IF;
        -- expected: not found (existence hidden)
    END;
    -- Absent id must raise identically.
    BEGIN
        PERFORM vc.cancel_generation(1, 9999);
        RAISE EXCEPTION 'cancelling an absent generation must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cancelling an absent generation must fail%' THEN
            RAISE;
        END IF;
        -- expected: not found
    END;
END $$;
COMMIT;
RESET ROLE;

-- Owner 2's generation is untouched by owner 1's failed cross-owner cancel.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.generation
     WHERE owner_user_id = 2 AND id = 2000 AND status = 'IN_PROGRESS';
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 generation must remain IN_PROGRESS'; END IF;

    -- Owner 2 can cancel its own generation.
    PERFORM vc.cancel_generation(2, 2000);
    SELECT count(*) INTO n FROM vc.generation
     WHERE owner_user_id = 2 AND id = 2000 AND status = 'CANCELLED';
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 generation must be CANCELLED after own cancel'; END IF;
END $$;
COMMIT;
RESET ROLE;
