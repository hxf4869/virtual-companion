-- 16_atomic_finalize_commits_all: finalize_generation commits every finalize
-- artifact together — final assistant message, candidate is_final, Generation
-- COMPLETED + assistant binding, provider usage, SETTLE quota ledger entry, a
-- PENDING chat.completed realtime event, and an eligible outbox event (INV-TX-001).

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
    r record;
    n int;
    gstatus text;
    gmsgid bigint;
BEGIN
    SELECT * INTO r FROM vc.finalize_generation(
        1, 5000, 6000, 'final answer', 'provider-a', 100, 50, 0.0020, 'USD', 10, true, NULL);
    IF r.out_finalized IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize must report finalized=true (got %)', r.out_finalized;
    END IF;
    IF r.out_generation_id <> 5000 THEN
        RAISE EXCEPTION 'finalize returned wrong generation id %', r.out_generation_id;
    END IF;
    IF r.out_assistant_message_id IS NULL THEN
        RAISE EXCEPTION 'finalize must return the assistant message id';
    END IF;

    SELECT status, assistant_message_id INTO gstatus, gmsgid
      FROM vc.generation WHERE owner_user_id = 1 AND id = 5000;
    IF gstatus <> 'COMPLETED' THEN
        RAISE EXCEPTION 'generation not COMPLETED (got %)', gstatus;
    END IF;
    IF gmsgid IS NULL OR gmsgid <> r.out_assistant_message_id THEN
        RAISE EXCEPTION 'generation assistant_message_id not bound to the final message';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM vc.message
                    WHERE owner_user_id = 1 AND conversation_id = 100 AND role = 'assistant') THEN
        RAISE EXCEPTION 'final assistant message missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.generation_candidate
                    WHERE owner_user_id = 1 AND generation_id = 5000 AND id = 6000 AND is_final) THEN
        RAISE EXCEPTION 'candidate not flagged final (INV-GEN-002)';
    END IF;

    SELECT count(*) INTO n FROM vc.generation_usage
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 usage row, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = 5000 AND kind = 'SETTLE';
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 SETTLE quota row, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000
       AND event_type = 'chat.completed' AND status = 'PENDING';
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 PENDING chat.completed, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.outbox_event
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 outbox row, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
