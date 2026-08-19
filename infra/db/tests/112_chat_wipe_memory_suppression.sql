-- 112_chat_wipe_memory_suppression: CHAT-WIPE / MEM-SUPPRESS V57 —
-- FR-DATA-003 全部聊天删除 + §11.16 删除防重学.
--
-- Covers: preview_chat_wipe counts conversations/messages/in-flight;
-- wipe_all_chats cancels in-flight chat work items, deletes every
-- conversation (cascade) and keeps relationships, memories and reminders;
-- delete_memory flips no_memory on the exact evidence source messages
-- ('message:<id>' refs only; 'import:archive' ignored; idempotent re-delete);
-- cross-owner isolation and the vc_api-only execute grant.

\set ON_ERROR_STOP on

TRUNCATE vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true), (2, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL), (1, 2, 1, NULL), (2, 1, 1, NULL);
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
VALUES (1, 10, 1, 'user', '这条产生了记忆'),
       (1, 11, 1, 'user', '这条属于另一条记忆'),
       (1, 12, 2, 'user', '第二条会话的消息'),
       (2, 20, 1, 'user', 'bob 的消息');
INSERT INTO vc.generation(owner_user_id, id, conversation_id,
                          logical_generation_id, status)
VALUES (1, 100, 1, 'lg-112-a', 'IN_PROGRESS'),
       (2, 200, 1, 'lg-112-b', 'IN_PROGRESS');
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
VALUES (1, 1000, 'GENERATION', 100, 'PENDING'),
       (1, 1001, 'MEMORY_EXTRACT', 100, 'PENDING'),
       (2, 2000, 'GENERATION', 200, 'PENDING');
INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
VALUES (1, 30, 1, 'RELATIONSHIP', '周五有汇报', 'ACCEPTED'),
       (1, 31, 1, 'RELATIONSHIP', '导入的记忆', 'ACCEPTED');
INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref)
VALUES (1, 300, 30, 'message:10'),
       (1, 301, 31, 'import:archive');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_conv_count   bigint;
    v_msg_count    bigint;
    v_in_flight    bigint;
    v_cancelled    bigint;
    v_no_memory    boolean;
    n              int;
BEGIN
    -- MEM-SUPPRESS: deleting memory 30 suppresses re-extraction from its
    -- exact source message 10; message 11 (another memory) is untouched.
    IF NOT vc.delete_memory(1, 30) THEN
        RAISE EXCEPTION 'delete_memory must succeed';
    END IF;
    SELECT no_memory INTO v_no_memory FROM vc.message WHERE owner_user_id = 1 AND id = 10;
    IF v_no_memory IS NOT TRUE THEN
        RAISE EXCEPTION 'source message 10 must be no_memory after delete';
    END IF;
    SELECT no_memory INTO v_no_memory FROM vc.message WHERE owner_user_id = 1 AND id = 11;
    IF v_no_memory IS NOT FALSE THEN
        RAISE EXCEPTION 'message 11 must stay extractable';
    END IF;
    -- Idempotent re-delete keeps returning TRUE (no double effect).
    IF NOT vc.delete_memory(1, 30) THEN
        RAISE EXCEPTION 'idempotent delete must return TRUE';
    END IF;

    -- CHAT-WIPE preview: 2 conversations, 3 messages, 2 in-flight items.
    SELECT out_conversation_count, out_message_count, out_in_flight_count
      INTO v_conv_count, v_msg_count, v_in_flight
      FROM vc.preview_chat_wipe(1);
    IF v_conv_count <> 2 OR v_msg_count <> 3 OR v_in_flight <> 2 THEN
        RAISE EXCEPTION 'preview counts wrong: % / % / %',
            v_conv_count, v_msg_count, v_in_flight;
    END IF;

    -- Wipe: everything chat-related goes; relationship + memories survive.
    SELECT out_conversations_deleted, out_messages_deleted, out_work_items_cancelled
      INTO v_conv_count, v_msg_count, v_cancelled
      FROM vc.wipe_all_chats(1);
    IF v_conv_count <> 2 OR v_msg_count <> 3 OR v_cancelled <> 2 THEN
        RAISE EXCEPTION 'wipe counts wrong: % / % / %',
            v_conv_count, v_msg_count, v_cancelled;
    END IF;

    SELECT count(*) INTO n FROM vc.conversation WHERE owner_user_id = 1;
    IF n <> 0 THEN
        RAISE EXCEPTION 'all conversations must be gone, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 1;
    IF n <> 0 THEN
        RAISE EXCEPTION 'all messages must be gone, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 1;
    IF n <> 1 THEN
        RAISE EXCEPTION 'relationship must survive the wipe';
    END IF;
    -- memory_item is SD-only; list with include_deleted to see both rows.
    SELECT count(*) INTO n FROM vc.list_memory(1, 1, true);
    IF n <> 2 THEN
        RAISE EXCEPTION 'memories must survive the wipe, got %', n;
    END IF;

    -- Wiping again is a no-op returning zeroes.
    SELECT out_conversations_deleted, out_messages_deleted, out_work_items_cancelled
      INTO v_conv_count, v_msg_count, v_cancelled
      FROM vc.wipe_all_chats(1);
    IF v_conv_count <> 0 OR v_msg_count <> 0 OR v_cancelled <> 0 THEN
        RAISE EXCEPTION 'second wipe must be a no-op, got % / % / %',
            v_conv_count, v_msg_count, v_cancelled;
    END IF;
END $$;
RESET ROLE;

-- work_item has no runtime-role grants (SD-only access); the CANCELLED
-- assertion runs as the migration/test role, outside any SET ROLE.
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.work_item
     WHERE owner_user_id = 1 AND status = 'CANCELLED';
    IF n <> 2 THEN
        RAISE EXCEPTION 'in-flight items must be CANCELLED, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.work_item
     WHERE owner_user_id = 2 AND status = 'PENDING';
    IF n <> 1 THEN
        RAISE EXCEPTION 'bob in-flight item must stay PENDING, got %', n;
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_conv_count bigint;
    v_msg_count  bigint;
    v_in_flight  bigint;
    n            int;
BEGIN
    -- Bob's chats are untouched by alice's wipe.
    SELECT out_conversation_count, out_message_count, out_in_flight_count
      INTO v_conv_count, v_msg_count, v_in_flight
      FROM vc.preview_chat_wipe(2);
    IF v_conv_count <> 1 OR v_msg_count <> 1 OR v_in_flight <> 1 THEN
        RAISE EXCEPTION 'bob preview wrong: % / % / %', v_conv_count, v_msg_count, v_in_flight;
    END IF;
    SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 2;
    IF n <> 1 THEN
        RAISE EXCEPTION 'bob message must survive, got %', n;
    END IF;

    -- Trusted-owner assertion: bob's context cannot wipe alice's rows.
    BEGIN
        PERFORM vc.wipe_all_chats(1);
        RAISE EXCEPTION 'owner-mismatched wipe unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN
            RAISE;
        END IF;
    END;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.wipe_all_chats(1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed wipe_all_chats';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
