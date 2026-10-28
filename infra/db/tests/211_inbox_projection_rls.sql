-- W10-T4: projection list is worker-only. Domain clears delete the current
-- owner's rows only while a deletion intent is active.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (21101, 'w10 t4 owner');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (21101, 21110, 'w10-t4-card', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (21101, 21111, 21110, '21100000-0000-0000-0000-000000000001', 'COMPANION');
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, body, status, normalization_status,
    event_id, deliverable, greeting_body, generation_outcome)
VALUES
    (21101, 21131, 21110, 'w10 t4 topic', 'BODY_READY', 'none',
     'w10-t4-body', 'DELIVERABLE', 'w10 t4 greeting', 'BODY_READY'),
    (21101, 21132, 21110, 'w10 t4 waiting', 'WAITING_HOST', 'none',
     'w10-t4-wait', 'NOT_DELIVERABLE', NULL, 'WAITING_HOST');
SELECT setval(
    'vc.follow_up_id_seq',
    GREATEST(21140, (SELECT last_value FROM vc.follow_up_id_seq)));

DO $$
DECLARE
    v_def text;
BEGIN
    IF (
        SELECT count(DISTINCT p.proname) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'vc'
          AND p.prosecdef
          AND p.proname IN (
              'list_inbox_projections',
              'clear_notification_domain_current',
              'clear_inbox_domain_current')
    ) <> 3 THEN
        RAISE EXCEPTION 'projection and clear functions must be SECURITY DEFINER';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        WHERE n.nspname = 'vc'
          AND p.proname IN (
              'list_inbox_projections',
              'clear_notification_domain_current',
              'clear_inbox_domain_current')
          AND a.grantee = 0
          AND a.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'projection functions must not be executable by PUBLIC';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname = 'vc'
          AND p.proname = 'list_inbox_projections'
          AND r.rolname = 'vc_api'
          AND a.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'vc_api must not list inbox projections';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
        JOIN pg_roles r ON r.oid = a.grantee
        WHERE n.nspname = 'vc'
          AND p.proname = 'list_inbox_projections'
          AND r.rolname = 'vc_worker'
          AND a.privilege_type = 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'vc_worker must list inbox projections';
    END IF;
    SELECT pg_get_functiondef('vc.list_inbox_projections()'::regprocedure) INTO v_def;
    IF position('credential' IN v_def) > 0 THEN
        RAISE EXCEPTION 'projection list must not read a channel secret';
    END IF;
    SELECT pg_get_functiondef('vc.load_notification_delivery(bigint,bigint,timestamptz)'::regprocedure) INTO v_def;
    IF position('credential' IN v_def) > 0 THEN
        RAISE EXCEPTION 'load function must not read a channel secret';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_create integer;
    v_wait integer;
BEGIN
    SELECT count(*) INTO v_create
      FROM vc.list_inbox_projections()
     WHERE out_owner = 21101 AND out_action = 'create' AND out_event_id = 'w10-t4-body'
       AND out_intent = 'BODY' AND out_conversation_id = 21111
       AND out_chat_identity = '21100000-0000-0000-0000-000000000001';
    SELECT count(*) INTO v_wait
      FROM vc.list_inbox_projections()
     WHERE out_owner = 21101 AND out_action = 'create' AND out_event_id = 'w10-t4-wait'
       AND out_intent = 'WAITING_HOST';
    IF v_create <> 1 OR v_wait <> 1 THEN
        RAISE EXCEPTION 'worker projection list missed a ready follow-up';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.list_inbox_projections();
    RAISE EXCEPTION 'vc_api listed inbox projections';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(21101, 'w10t4', encode(vc.hmac(convert_to('vc-owner-binding-v1|21101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w10t4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_cleared boolean;
    v_inbox integer;
    v_delivery integer;
    v_channel integer;
BEGIN
    PERFORM vc.create_inbox_event(21101, 'w10-t4-body', 21111, NULL, NULL, NULL);
    PERFORM vc.put_notification_channel(21101, 'EMAIL', true, 'owner@example.test', NULL, false, ARRAY[21110]::bigint[]);
    PERFORM vc.record_consent(21101, 'PUSH_NOTIFICATION', 'w10-t4', true);
    PERFORM vc.create_notification_delivery(21101, 'w10-t4-body', 'EMAIL', 'owner@example.test');
    SELECT vc.clear_notification_domain_current() INTO v_cleared;
    IF v_cleared THEN
        RAISE EXCEPTION 'clear ran without a deletion intent';
    END IF;
    SELECT vc.clear_inbox_domain_current() INTO v_cleared;
    IF v_cleared THEN
        RAISE EXCEPTION 'inbox clear ran without a deletion intent';
    END IF;
    SELECT count(*) INTO v_delivery FROM vc.notification_delivery WHERE event_id = 'w10-t4-body';
    SELECT count(*) INTO v_channel FROM vc.notification_channel WHERE configured_target = 'owner@example.test';
    SELECT count(*) INTO v_inbox FROM vc.inbox_event WHERE event_id = 'w10-t4-body';
    IF v_delivery <> 1 OR v_channel <> 1 OR v_inbox <> 1 THEN
        RAISE EXCEPTION 'clear without intent removed rows';
    END IF;
END $$;
COMMIT;
RESET ROLE;

INSERT INTO vc.account_deletion_intent(account_id, username_digest, status)
VALUES (21101, '0000000000000000000000000000000000000000000000000000000000000211', 'REQUESTED');

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.list_inbox_projections() WHERE out_owner = 21101) <> 0 THEN
        RAISE EXCEPTION 'deletion intent stayed in the projection list';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(21101, 'w10t4b', encode(vc.hmac(convert_to('vc-owner-binding-v1|21101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w10t4b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_cleared boolean;
    v_inbox integer;
    v_delivery integer;
    v_channel integer;
BEGIN
    SELECT vc.clear_notification_domain_current() INTO v_cleared;
    IF NOT v_cleared THEN
        RAISE EXCEPTION 'notification clear did not run during deletion';
    END IF;
    SELECT count(*) INTO v_delivery FROM vc.notification_delivery WHERE owner_user_id = 21101;
    SELECT count(*) INTO v_channel FROM vc.notification_channel WHERE owner_user_id = 21101;
    SELECT count(*) INTO v_inbox FROM vc.inbox_event WHERE owner_user_id = 21101;
    IF v_delivery <> 0 OR v_channel <> 0 OR v_inbox <> 1 THEN
        RAISE EXCEPTION 'notification clear did not leave the inbox row';
    END IF;
    SELECT vc.clear_inbox_domain_current() INTO v_cleared;
    IF NOT v_cleared THEN
        RAISE EXCEPTION 'inbox clear did not run during deletion';
    END IF;
    SELECT count(*) INTO v_inbox FROM vc.inbox_event WHERE owner_user_id = 21101;
    IF v_inbox <> 0 THEN
        RAISE EXCEPTION 'inbox clear left a row';
    END IF;
END $$;
COMMIT;
RESET ROLE;
