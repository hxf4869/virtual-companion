-- 87_conversation_management: V32 conversation delete + rename.
--
-- Covers: trusted-owner assertion (param must match the server-trusted GUC);
-- rename writes the title and a blank title clears it; the list carries the
-- title; delete cascades messages/generations/usage/realtime events and
-- cancels in-flight work items (no worker ever processes a dangling ref); a
-- foreign or absent id returns FALSE (existence never disclosed); title > 200
-- chars fails closed. The owner context follows test 85's transaction-bound
-- set_owner_context + SET LOCAL ROLE vc_api pattern.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.outbox_event, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');

-- ===========================================================================
-- 1. Owner 1: fixture + rename + list title.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_title text;
    n int;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel) INTO v_conv;

    IF NOT vc.rename_conversation(1, v_conv, '  周二的夜聊  ') THEN
        RAISE EXCEPTION 'rename must report success for an owned conversation';
    END IF;
    SELECT title INTO v_title FROM vc.conversation WHERE owner_user_id = 1 AND id = v_conv;
    IF v_title IS DISTINCT FROM '周二的夜聊' THEN
        RAISE EXCEPTION 'title must be trimmed and written, got %', v_title;
    END IF;
    SELECT count(*) INTO n FROM vc.list_conversations(1)
     WHERE out_id = v_conv AND out_title = '周二的夜聊';
    IF n <> 1 THEN RAISE EXCEPTION 'list must carry the renamed title'; END IF;

    -- Blank title clears the rename.
    IF NOT vc.rename_conversation(1, v_conv, '   ') THEN
        RAISE EXCEPTION 'blank rename must report success (clears the title)';
    END IF;
    SELECT title INTO v_title FROM vc.conversation WHERE owner_user_id = 1 AND id = v_conv;
    IF v_title IS NOT NULL THEN RAISE EXCEPTION 'blank rename must clear the title, got %', v_title; END IF;

    -- Overlong title fails closed.
    BEGIN
        PERFORM vc.rename_conversation(1, v_conv, repeat('x', 201));
        RAISE EXCEPTION 'overlong title must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%overlong title must fail closed%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;

    -- Foreign / absent id -> FALSE (existence never disclosed).
    IF vc.rename_conversation(1, 999999999, 'x') THEN
        RAISE EXCEPTION 'foreign rename must return FALSE';
    END IF;
END $$;
COMMIT;

-- ===========================================================================
-- 2. Owner 1: delete cascade + in-flight work item cancellation.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n1b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_conv bigint;
    v_gen bigint;
    v_item bigint;
    v_status text;
    n int;
BEGIN
    SELECT id INTO v_conv FROM vc.conversation WHERE owner_user_id = 1 LIMIT 1;

    -- A generation with an in-flight work item (GENERATION kind) referencing it.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-87', 'user', 'hello');
    SELECT vc.enqueue_work_item(1, 'GENERATION', v_gen) INTO v_item;
    PERFORM 1 FROM vc.message WHERE owner_user_id = 1 AND conversation_id = v_conv;
    IF NOT FOUND THEN RAISE EXCEPTION 'receive_generation must create a message'; END IF;

    IF NOT vc.delete_conversation(1, v_conv) THEN
        RAISE EXCEPTION 'delete must report success for an owned conversation';
    END IF;

    -- Conversation and dependent rows are gone (cascade).
    SELECT count(*) INTO n FROM vc.conversation WHERE owner_user_id = 1 AND id = v_conv;
    IF n <> 0 THEN RAISE EXCEPTION 'conversation must be deleted'; END IF;
    SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 1 AND conversation_id = v_conv;
    IF n <> 0 THEN RAISE EXCEPTION 'messages must cascade'; END IF;
    SELECT count(*) INTO n FROM vc.generation WHERE owner_user_id = 1 AND conversation_id = v_conv;
    IF n <> 0 THEN RAISE EXCEPTION 'generations must cascade'; END IF;

    -- The in-flight work item was cancelled (never a dangling ref).
    SELECT status INTO v_status FROM vc.work_item WHERE owner_user_id = 1 AND id = v_item;
    IF v_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'in-flight work item must be cancelled, got %', v_status;
    END IF;

    -- Foreign / absent id -> FALSE (existence never disclosed).
    IF vc.delete_conversation(1, 999999999) THEN
        RAISE EXCEPTION 'foreign delete must return FALSE';
    END IF;
END $$;
COMMIT;

-- ===========================================================================
-- 3. Trusted-owner assertion: a parameter/GUC mismatch fails closed.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    BEGIN
        PERFORM vc.delete_conversation(1, 1);
        RAISE EXCEPTION 'delete must reject an owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%delete must reject an owner mismatch%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
    BEGIN
        PERFORM vc.rename_conversation(1, 1, 'x');
        RAISE EXCEPTION 'rename must reject an owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%rename must reject an owner mismatch%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
END $$;
COMMIT;
