-- 105_end_conversation: END-TODAY V50 — end today's conversation.
--
-- Covers: end keeps the conversation row; incognito clears message bodies so
-- list preview and list_messages no longer carry the original text; a
-- non-incognito conversation keeps its bodies; in-flight GENERATION work
-- items become CANCELLED; generation / consent / identity rows stay;
-- foreign / absent ids return no rows; trusted-owner mismatch fail-closed;
-- vc_worker cannot execute.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.outbox_event, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account,
         vc.consent_record, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_inc bigint;
    v_norm bigint;
    v_gen bigint;
    v_ok boolean;
    v_cleared boolean;
    v_preview text;
    v_body text;
    n int;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel, true) INTO v_inc;
    SELECT vc.create_conversation(1, v_rel, false) INTO v_norm;

    PERFORM vc.receive_generation(1, v_inc, 'idem-105-inc', 'user', '无痕秘密正文');
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_norm, 'idem-105-norm', 'user', '普通会话正文');
    PERFORM vc.enqueue_work_item(1, 'GENERATION', v_gen);
    PERFORM vc.record_consent(1, 'MODEL_TRAINING', '2026-08', true);

    SELECT count(*) INTO n FROM vc.end_conversation(1, 999999999);
    IF n <> 0 THEN
        RAISE EXCEPTION 'absent end must return no rows';
    END IF;

    SELECT out_ok, out_incognito_cleared INTO v_ok, v_cleared
      FROM vc.end_conversation(1, v_inc);
    IF v_ok IS NOT TRUE OR v_cleared IS NOT TRUE THEN
        RAISE EXCEPTION 'incognito end must report ok+cleared, got % %', v_ok, v_cleared;
    END IF;

    SELECT count(*) INTO n FROM vc.conversation
     WHERE owner_user_id = 1 AND id = v_inc;
    IF n <> 1 THEN
        RAISE EXCEPTION 'end must keep the conversation row';
    END IF;
    SELECT count(*) INTO n FROM vc.generation
     WHERE owner_user_id = 1 AND conversation_id = v_inc;
    IF n <> 1 THEN
        RAISE EXCEPTION 'end must keep generation rows';
    END IF;

    SELECT out_content INTO v_body
      FROM vc.list_messages(1, v_inc, 0, 50)
     ORDER BY out_id LIMIT 1;
    IF v_body IS DISTINCT FROM '' THEN
        RAISE EXCEPTION 'incognito history must no longer expose original text, got %', v_body;
    END IF;
    SELECT out_last_message_preview INTO v_preview
      FROM vc.list_conversations(1, v_rel, 0, 100)
     WHERE out_id = v_inc;
    IF v_preview IS DISTINCT FROM '' THEN
        RAISE EXCEPTION 'incognito preview must no longer expose original text, got %', v_preview;
    END IF;

    SELECT out_ok, out_incognito_cleared INTO v_ok, v_cleared
      FROM vc.end_conversation(1, v_norm);
    IF v_ok IS NOT TRUE OR v_cleared IS NOT FALSE THEN
        RAISE EXCEPTION 'non-incognito end must report ok without clearing, got % %', v_ok, v_cleared;
    END IF;
    SELECT out_content INTO v_body
      FROM vc.list_messages(1, v_norm, 0, 50)
     ORDER BY out_id LIMIT 1;
    IF v_body IS DISTINCT FROM '普通会话正文' THEN
        RAISE EXCEPTION 'non-incognito body must stay, got %', v_body;
    END IF;
END $$;
RESET ROLE;
DO $$
DECLARE
    v_status text;
    n int;
BEGIN
    SELECT status INTO v_status FROM vc.work_item
     WHERE owner_user_id = 1 AND kind = 'GENERATION'
     ORDER BY id DESC LIMIT 1;
    IF v_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'in-flight work item must be cancelled, got %', v_status;
    END IF;
    SELECT count(*) INTO n FROM vc.consent_record WHERE owner_user_id = 1;
    IF n <> 1 THEN
        RAISE EXCEPTION 'end must not touch account-level consent';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SELECT set_config('vc.test_alice_conv', id::text, true)
  FROM vc.conversation WHERE owner_user_id = 1 ORDER BY id LIMIT 1;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint;
    n int;
BEGIN
    v_alice := current_setting('vc.test_alice_conv')::bigint;
    SELECT count(*) INTO n FROM vc.end_conversation(2, v_alice);
    IF n <> 0 THEN
        RAISE EXCEPTION 'cross-owner end must return no rows';
    END IF;
    BEGIN
        PERFORM vc.end_conversation(1, v_alice);
        RAISE EXCEPTION 'end must reject an owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%end must reject an owner mismatch%' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM vc.end_conversation(1, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed end_conversation';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
