-- 41_generation_terminal_transitions: terminalize_generation moves a
-- non-terminal generation to FAILED_FINAL / OUTPUT_BLOCKED / COMPLETED_FALLBACK
-- only along catalog-legal edges (generation-states.yaml). Illegal from-states,
-- already-terminal generations, unknown generations and direct CANCELLED are
-- all rejected (fail closed). The terminal realtime_event lands in the same
-- transaction (INV-TX-001, covered in 42).

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');

-- fixture generations in each pre-terminal state used by the catalog edges.
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status) VALUES
    (1, 5001, 100, 'gen-t1', 'IN_PROGRESS'),
    (1, 5002, 100, 'gen-t2', 'WAITING_FOR_CAPACITY'),
    (1, 5003, 100, 'gen-t3', 'COMMITTING'),
    (1, 5004, 100, 'gen-t4', 'FINAL_REVIEW'),
    (1, 5005, 100, 'gen-t5', 'QUEUED'),
    (1, 5006, 100, 'gen-t6', 'COMPLETED'),
    (1, 5007, 100, 'gen-t7', 'FINAL_REVIEW');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v text;
    n int;
BEGIN
    -- Legal: IN_PROGRESS -> FAILED_FINAL (chat.failed).
    v := vc.terminalize_generation(1, 5001, 'FAILED_FINAL', 'chat.failed', '{"reason":"provider error"}'::jsonb);
    IF v <> 'FAILED_FINAL' THEN
        RAISE EXCEPTION 'terminalize must return the new status (got %)', v;
    END IF;
    SELECT status INTO v FROM vc.generation WHERE owner_user_id = 1 AND id = 5001;
    IF v <> 'FAILED_FINAL' THEN
        RAISE EXCEPTION 'generation 5001 must be FAILED_FINAL (got %)', v;
    END IF;

    -- Legal: WAITING_FOR_CAPACITY -> FAILED_FINAL.
    PERFORM vc.terminalize_generation(1, 5002, 'FAILED_FINAL', 'chat.failed');
    SELECT status INTO v FROM vc.generation WHERE owner_user_id = 1 AND id = 5002;
    IF v <> 'FAILED_FINAL' THEN
        RAISE EXCEPTION 'generation 5002 must be FAILED_FINAL (got %)', v;
    END IF;

    -- Legal: COMMITTING -> FAILED_FINAL and COMMITTING -> COMPLETED_FALLBACK.
    PERFORM vc.terminalize_generation(1, 5003, 'COMPLETED_FALLBACK', 'chat.completed', '{"fallback":true}'::jsonb);
    SELECT status INTO v FROM vc.generation WHERE owner_user_id = 1 AND id = 5003;
    IF v <> 'COMPLETED_FALLBACK' THEN
        RAISE EXCEPTION 'generation 5003 must be COMPLETED_FALLBACK (got %)', v;
    END IF;

    -- Legal: FINAL_REVIEW -> OUTPUT_BLOCKED (chat.blocked).
    PERFORM vc.terminalize_generation(1, 5004, 'OUTPUT_BLOCKED', 'chat.blocked', '{"reason":"safety"}'::jsonb);
    SELECT status INTO v FROM vc.generation WHERE owner_user_id = 1 AND id = 5004;
    IF v <> 'OUTPUT_BLOCKED' THEN
        RAISE EXCEPTION 'generation 5004 must be OUTPUT_BLOCKED (got %)', v;
    END IF;

    -- Illegal: QUEUED -> FAILED_FINAL (catalog has no such edge).
    BEGIN
        PERFORM vc.terminalize_generation(1, 5005, 'FAILED_FINAL', 'chat.failed');
        RAISE EXCEPTION 'QUEUED -> FAILED_FINAL must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%QUEUED -> FAILED_FINAL must be rejected%' THEN
            RAISE;
        END IF;
        -- expected
    END;
    SELECT status INTO v FROM vc.generation WHERE owner_user_id = 1 AND id = 5005;
    IF v <> 'QUEUED' THEN
        RAISE EXCEPTION 'generation 5005 must remain QUEUED (got %)', v;
    END IF;

    -- Already terminal: COMPLETED cannot be terminalized again.
    BEGIN
        PERFORM vc.terminalize_generation(1, 5006, 'FAILED_FINAL', 'chat.failed');
        RAISE EXCEPTION 'terminal generation must reject further terminalize';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%terminal generation must reject further terminalize%' THEN
            RAISE;
        END IF;
        -- expected
    END;

    -- Direct CANCELLED is rejected (double-hop stays with cancel_generation).
    BEGIN
        PERFORM vc.terminalize_generation(1, 5007, 'CANCELLED', 'chat.cancelled');
        RAISE EXCEPTION 'direct CANCELLED must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%direct CANCELLED must be rejected%' THEN
            RAISE;
        END IF;
        -- expected
    END;

    -- Unknown generation fails closed.
    BEGIN
        PERFORM vc.terminalize_generation(1, 9999, 'FAILED_FINAL', 'chat.failed');
        RAISE EXCEPTION 'unknown generation must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unknown generation must be rejected%' THEN
            RAISE;
        END IF;
        -- expected
    END;

    -- A rollback test: an aborted terminalize leaves no terminal event behind.
    BEGIN
        PERFORM vc.terminalize_generation(1, 5007, 'FAILED_FINAL', 'chat.completed');
        RAISE EXCEPTION 'event-type mismatch must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%event-type mismatch must be rejected%' THEN
            RAISE;
        END IF;
        -- expected (chat.completed on FAILED_FINAL is INV-GEN-003)
    END;
    SELECT count(*) INTO n FROM vc.realtime_event WHERE generation_id = 5007;
    IF n <> 0 THEN
        RAISE EXCEPTION 'aborted terminalize must leave no realtime_event (got %)', n;
    END IF;
    SELECT status INTO v FROM vc.generation WHERE owner_user_id = 1 AND id = 5007;
    IF v <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'aborted terminalize must not change status (got %)', v;
    END IF;
END $$;
COMMIT;
RESET ROLE;
