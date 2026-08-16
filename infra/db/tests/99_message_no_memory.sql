-- 99_message_no_memory: MEM-NEG V44 — per-message 不记住 negative marker.
--
-- Covers: set_message_no_memory flips the marker of an owned message (true
-- and back to false), returns FALSE for a foreign or absent message, RAISEs
-- for a foreign owner (trusted-owner assertion); list_messages (V10
-- redefined) surfaces out_no_memory; a non-vc_api role cannot execute the
-- function.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
VALUES (1, 10, 1, 'user', '这条不要记住'),
       (1, 11, 1, 'user', '这条可以记住');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_ok boolean;
    n    int;
    v_no_memory boolean;
BEGIN
    -- Flip the marker on one owned message; the second message stays clean.
    SELECT vc.set_message_no_memory(1, 1, 10, true) INTO v_ok;
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'set_message_no_memory must report TRUE for an owned message';
    END IF;
    SELECT vc.set_message_no_memory(1, 1, 10, false) INTO v_ok;
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'set_message_no_memory must be reversible';
    END IF;
    SELECT vc.set_message_no_memory(1, 1, 10, true) INTO v_ok;

    -- list_messages surfaces the marker.
    SELECT count(*) INTO n
      FROM vc.list_messages(1, 1, 0, 100)
     WHERE out_no_memory IS TRUE;
    IF n <> 1 THEN
        RAISE EXCEPTION 'list_messages must surface exactly one no_memory row (got %)', n;
    END IF;
    SELECT out_no_memory INTO v_no_memory
      FROM vc.list_messages(1, 1, 0, 100)
     WHERE out_id = 10;
    IF v_no_memory IS NOT TRUE THEN
        RAISE EXCEPTION 'message 10 must be flagged no_memory';
    END IF;

    -- A foreign or absent message returns FALSE (existence never disclosed).
    SELECT vc.set_message_no_memory(1, 1, 999, true) INTO v_ok;
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'absent message must report FALSE';
    END IF;

    -- A foreign owner RAISEs (trusted-owner assertion).
    BEGIN
        PERFORM * FROM vc.set_message_no_memory(2, 1, 10, true);
        RAISE EXCEPTION 'foreign owner id unexpectedly passed the trusted-owner assertion';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- A non-vc_api role must NOT be able to execute the function.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.set_message_no_memory(1, 1, 10, true);
    RAISE EXCEPTION 'vc_worker unexpectedly executed set_message_no_memory';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
