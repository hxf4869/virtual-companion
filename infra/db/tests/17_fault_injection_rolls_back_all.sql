-- 17_fault_injection_rolls_back_all: a fault injected AFTER the finalize writes
-- aborts the whole transaction, so NOTHING commits — generation stays
-- FINAL_REVIEW, candidate not final, no assistant message, and zero
-- usage/quota/realtime/outbox rows (INV-TX-001 atomic rollback).
-- Context is bound with SET LOCAL before the DO block so the inner exception
-- subtransaction rolls back to the outer owner value for verification.

\set ON_ERROR_STOP on

TRUNCATE vc.outbox_event, vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-final-1', 'FINAL_REVIEW');
INSERT INTO vc.generation_candidate(owner_user_id, id, generation_id, content, is_final)
VALUES (1, 6000, 5000, 'draft answer', false);

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    gstatus text;
    gmsgid bigint;
BEGIN
    BEGIN
        -- Fault fires after every write; the surrounding transaction must roll
        -- back all of them.
        PERFORM * FROM vc.finalize_generation(
            1, 5000, 6000, 'final answer', 'provider-a', 100, 50, 0.0020, 'USD', 10, true,
            'INJECT_ROLLBACK');
        RAISE EXCEPTION 'fault injection unexpectedly committed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%fault injection unexpectedly committed%' THEN
            RAISE;
        END IF;
        -- expected: injected fault aborted the finalize transaction
    END;

    SELECT status, assistant_message_id INTO gstatus, gmsgid
      FROM vc.generation WHERE owner_user_id = 1 AND id = 5000;
    IF gstatus <> 'FINAL_REVIEW' THEN
        RAISE EXCEPTION 'generation status changed despite rollback: %', gstatus;
    END IF;
    IF gmsgid IS NOT NULL THEN
        RAISE EXCEPTION 'assistant_message_id set despite rollback';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.generation_candidate
                WHERE owner_user_id = 1 AND generation_id = 5000 AND is_final) THEN
        RAISE EXCEPTION 'candidate flagged final despite rollback';
    END IF;
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 100 AND role = 'assistant';
    IF n <> 0 THEN RAISE EXCEPTION 'assistant message committed despite rollback: %', n; END IF;
    SELECT count(*) INTO n FROM vc.generation_usage
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'usage committed despite rollback: %', n; END IF;
    SELECT count(*) INTO n FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'quota committed despite rollback: %', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'realtime committed despite rollback: %', n; END IF;
    SELECT count(*) INTO n FROM vc.outbox_event
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'outbox committed despite rollback: %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
