-- 92_message_delete: MSG-DELETE V37 — vc.delete_message deletes one owned
-- message of the caller's conversation, removes the memory_evidence rows whose
-- source_ref points at it (no dangling evidence), keeps the confirmed memory
-- items themselves, clears the owning generation's assistant_message_id via
-- the V7 SET NULL FK, returns FALSE for foreign/absent targets (existence
-- never disclosed), and is closed to non-vc_api roles.

\set ON_ERROR_STOP on

TRUNCATE vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'conv');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen    bigint;
    v_msg1   bigint;
    v_mem    bigint;
    v_st     text;
    v_cand   bigint;
    v_final  boolean;
BEGIN
    -- One user message with a memory candidate whose evidence points at it.
    SELECT generation_id, message_id INTO v_gen, v_msg1
      FROM vc.receive_generation(1, 100, 'key-92', 'user', 'hello');
    SELECT vc.create_memory_candidate(1, 10, 'SESSION', 'mem-92', 100,
                                      ARRAY['message:' || v_msg1]) INTO v_mem;

    -- A second turn fully finalized so an assistant message exists.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, 100, 'key-93', 'user', 'again');
    v_st := vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    v_st := vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    SELECT out_candidate_id INTO v_cand
      FROM vc.insert_generation_candidate(1, v_gen, 'assistant reply', false);
    SELECT out_finalized INTO v_final
      FROM vc.finalize_generation(1, v_gen, v_cand, 'assistant reply', '', 0, 0, 0, 'USD', 0, false, NULL);

    -- Delete the first user message: must succeed.
    IF vc.delete_message(1, 100, v_msg1) IS NOT TRUE THEN
        RAISE EXCEPTION 'delete_message must delete the owned message';
    END IF;

    -- Foreign or absent target: FALSE, never an error.
    IF vc.delete_message(1, 100, 999999) IS NOT FALSE THEN
        RAISE EXCEPTION 'absent message must return FALSE';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Assertions as superuser: message gone, evidence cleaned, memory kept; then
-- delete the assistant message and prove the SET NULL link behaviour.
DO $$
DECLARE
    n_msg   int;
    n_ev    int;
    n_mem   int;
    v_assistant bigint;
BEGIN
    SELECT count(*) INTO n_msg FROM vc.message WHERE owner_user_id = 1 AND content = 'hello';
    IF n_msg <> 0 THEN
        RAISE EXCEPTION 'deleted user message still present (%)', n_msg;
    END IF;

    SELECT count(*) INTO n_ev FROM vc.memory_evidence
     WHERE owner_user_id = 1 AND source_ref LIKE 'message:%';
    IF n_ev <> 0 THEN
        RAISE EXCEPTION 'evidence rows must be removed with the message (%)', n_ev;
    END IF;

    -- The confirmed memory item survives (independent canonical data).
    SELECT count(*) INTO n_mem FROM vc.memory_item WHERE owner_user_id = 1;
    IF n_mem <> 1 THEN
        RAISE EXCEPTION 'memory item must survive message deletion (%)', n_mem;
    END IF;

    -- The finalized generation still links its assistant message.
    SELECT assistant_message_id INTO v_assistant FROM vc.generation
     WHERE owner_user_id = 1 AND assistant_message_id IS NOT NULL LIMIT 1;
    IF v_assistant IS NULL THEN
        RAISE EXCEPTION 'expected a linked assistant message before deletion';
    END IF;

    -- Delete the assistant message (superuser bypasses the EXECUTE grant; the
    -- trusted-owner context is bound explicitly).
    PERFORM vc.set_owner_context(1, 'n4', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|1|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    IF vc.delete_message(1, 100, v_assistant) IS NOT TRUE THEN
        RAISE EXCEPTION 'assistant message delete must succeed';
    END IF;

    -- The assistant-message link is cleared by the V7 ON DELETE SET NULL FK.
    IF EXISTS (SELECT 1 FROM vc.generation
                WHERE owner_user_id = 1 AND assistant_message_id IS NOT NULL) THEN
        RAISE EXCEPTION 'assistant_message_id must be cleared after message deletion';
    END IF;

    -- The generation row itself survives.
    IF NOT EXISTS (SELECT 1 FROM vc.generation WHERE owner_user_id = 1) THEN
        RAISE EXCEPTION 'generation rows must survive message deletion';
    END IF;
END $$;

-- Cross-tenant composite guard: bob's message cannot be addressed under
-- alice's conversation (owner + conversation composite mismatch) — FALSE with
-- no disclosure; bob's own composite succeeds.
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-a', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (2, 200, 20, 'bob-conv');
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen  bigint;
    v_msg  bigint;
    v_ok   boolean;
BEGIN
    SELECT generation_id, message_id INTO v_gen, v_msg
      FROM vc.receive_generation(2, 200, 'key-bob-1', 'user', 'bob hello');

    -- Composite mismatch (bob's message + alice's conversation 100): FALSE.
    SELECT vc.delete_message(2, 100, v_msg) INTO v_ok;
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'cross-tenant composite mismatch must return FALSE (got %)', v_ok;
    END IF;

    -- Bob's own composite succeeds.
    SELECT vc.delete_message(2, 200, v_msg) INTO v_ok;
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'owner composite delete must return TRUE (got %)', v_ok;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A non-vc_api role must NOT be able to call the function (closed by default).
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.delete_message(1, 100, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed delete_message';
EXCEPTION
    WHEN insufficient_privilege THEN
        -- expected: EXECUTE was revoked from PUBLIC and granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
