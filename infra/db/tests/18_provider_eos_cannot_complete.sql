-- 18_provider_eos_cannot_complete: a generation NOT in FINAL_REVIEW (e.g. still
-- IN_PROGRESS at provider EOS) is rejected by finalize_generation, so a provider
-- EOS can never imply chat.completed (INV-GEN-003). Also asserts a non-vc_api
-- role cannot invoke finalize_generation (EXECUTE isolation, TASK-0016 P0 class).

\set ON_ERROR_STOP on

TRUNCATE vc.outbox_event, vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route, vc.generation,
         vc.message, vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
-- Generation still streaming (provider EOS would arrive here); not yet reviewed.
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5001, 100, 'gen-eos-1', 'IN_PROGRESS');
INSERT INTO vc.generation_candidate(owner_user_id, id, generation_id, content, is_final)
VALUES (1, 6001, 5001, 'partial answer', false);

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    gstatus text;
BEGIN
    BEGIN
        PERFORM * FROM vc.finalize_generation(
            1, 5001, 6001, 'final answer', 'provider-a', 1, 1, 0, 'USD', 1, true, NULL);
        RAISE EXCEPTION 'finalize of an IN_PROGRESS generation unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%finalize of an IN_PROGRESS generation unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        -- expected: precondition requires FINAL_REVIEW (INV-GEN-003)
    END;

    -- Generation is unchanged: still IN_PROGRESS, never COMPLETED.
    SELECT status INTO gstatus FROM vc.generation WHERE owner_user_id = 1 AND id = 5001;
    IF gstatus <> 'IN_PROGRESS' THEN
        RAISE EXCEPTION 'IN_PROGRESS generation changed status to % despite EOS guard', gstatus;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.realtime_event
                WHERE owner_user_id = 1 AND generation_id = 5001
                  AND event_type = 'chat.completed') THEN
        RAISE EXCEPTION 'chat.completed emitted for an unreviewed generation';
    END IF;
    SELECT count(*) INTO n FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 100 AND role = 'assistant';
    IF n <> 0 THEN RAISE EXCEPTION 'assistant message written despite EOS guard: %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Regression for the TASK-0016 P0 class: a non-vc_api role must NOT be able to
-- invoke finalize_generation. V7 revokes PUBLIC EXECUTE and grants only vc_api.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.finalize_generation(
        1, 5001, 6001, 'x', 'p', 1, 1, 0, 'USD', 1, true, NULL);
    RAISE EXCEPTION 'vc_worker unexpectedly executed finalize_generation';
EXCEPTION
    WHEN insufficient_privilege THEN
        -- expected: EXECUTE was revoked from PUBLIC and granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
