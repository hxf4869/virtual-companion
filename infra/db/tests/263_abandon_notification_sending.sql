-- W16 review: abandon_notification_sending turns one stale sending row into
-- unknown and returns NOTIFICATION_SENDING_UNKNOWN. The peer may already
-- have the message, so the row is not put back to pending. A row still
-- inside the caller's bound stays sending. The function names one owner
-- and does not change another owner's row. Runtime roles cannot call it;
-- the worker sweep is the granted entry.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (26301, 'w16e abandon'), (26302, 'w16e abandon other')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (26301, 'w16e-263-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
       (26302, 'w16e-263-other', 'synthetic', 'USER', 'ACTIVE', 'other')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (26301, 10, 'persona-a', true), (26302, 10, 'persona-b', true)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES
    (26301, 26321, 10, 'w16e', '26300000-0000-4000-8000-000000002631', 'COMPANION', 'PRESENT', false),
    (26302, 26322, 10, 'w16e', '26300000-0000-4000-8000-000000002632', 'COMPANION', 'PRESENT', false)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, body, status, normalization_status,
    event_id, deliverable, greeting_body, generation_outcome)
VALUES
    (26301, 26331, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-263-stale', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26301, 26332, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-263-fresh', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26302, 26333, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-263-other', 'DELIVERABLE', '下周见', 'BODY_READY');
INSERT INTO vc.inbox_event(
    owner_user_id, id, event_id, relationship_id, conversation_id, intent, body)
VALUES
    (26301, 26341, 'fu-w16e-263-stale', 10, 26321, 'BODY', '下周见'),
    (26301, 26342, 'fu-w16e-263-fresh', 10, 26321, 'BODY', '下周见'),
    (26302, 26343, 'fu-w16e-263-other', 10, 26322, 'BODY', '下周见');
INSERT INTO vc.notification_delivery(
    owner_user_id, id, event_id, channel, configured_target)
VALUES
    (26301, 26311, 'fu-w16e-263-stale', 'EMAIL', 'stale@example.test'),
    (26301, 26312, 'fu-w16e-263-fresh', 'EMAIL', 'fresh@example.test'),
    (26302, 26313, 'fu-w16e-263-other', 'EMAIL', 'other@example.test');
UPDATE vc.notification_delivery
   SET status = 'sending', updated_at = clock_timestamp() - interval '2 minutes'
 WHERE owner_user_id = 26301 AND id = 26311;
UPDATE vc.notification_delivery
   SET status = 'sending', updated_at = clock_timestamp() - interval '30 seconds'
 WHERE owner_user_id = 26301 AND id = 26312;
UPDATE vc.notification_delivery
   SET status = 'sending'
 WHERE owner_user_id = 26302 AND id = 26313;

DO $$
BEGIN
    IF has_function_privilege('public', 'vc.abandon_notification_sending(bigint,bigint,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public can abandon notification sending';
    END IF;
    IF has_function_privilege('vc_api', 'vc.abandon_notification_sending(bigint,bigint,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api can abandon notification sending';
    END IF;
    IF has_function_privilege('vc_worker', 'vc.abandon_notification_sending(bigint,bigint,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker can abandon notification sending';
    END IF;
    IF has_function_privilege('vc_dispatcher', 'vc.abandon_notification_sending(bigint,bigint,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_dispatcher can abandon notification sending';
    END IF;
    IF has_function_privilege('vc_job_coordinator', 'vc.abandon_notification_sending(bigint,bigint,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_job_coordinator can abandon notification sending';
    END IF;
END $$;

DO $$
DECLARE
    v_code text;
    v_status text;
    v_attempts integer;
    v_failure text;
    v_next timestamptz;
    v_owner bigint;
BEGIN
    BEGIN
        PERFORM vc.abandon_notification_sending(26301, 26311, 0);
        RAISE EXCEPTION 'zero bound was accepted';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%must be positive%' THEN
                RAISE;
            END IF;
    END;
    v_code := vc.abandon_notification_sending(26301, 26311, 40);
    IF v_code IS DISTINCT FROM 'NOTIFICATION_SENDING_UNKNOWN' THEN
        RAISE EXCEPTION 'decision code %', v_code;
    END IF;
    SELECT status, attempt_count, failure_code, next_attempt_at, owner_user_id
      INTO v_status, v_attempts, v_failure, v_next, v_owner
      FROM vc.notification_delivery
     WHERE owner_user_id = 26301 AND id = 26311;
    IF v_status IS DISTINCT FROM 'unknown' OR v_attempts IS DISTINCT FROM 1
       OR v_failure IS NOT NULL OR v_next IS NOT NULL OR v_owner IS DISTINCT FROM 26301 THEN
        RAISE EXCEPTION 'stale became % attempts % failure % next % owner %',
            v_status, v_attempts, v_failure, v_next, v_owner;
    END IF;
    v_code := vc.abandon_notification_sending(26301, 26311, 40);
    IF v_code IS NOT NULL THEN
        RAISE EXCEPTION 'second abandon %', v_code;
    END IF;
    IF (SELECT attempt_count FROM vc.notification_delivery WHERE owner_user_id = 26301 AND id = 26311) IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'attempt incremented twice';
    END IF;
    v_code := vc.abandon_notification_sending(26301, 26312, 40);
    IF v_code IS NOT NULL THEN
        RAISE EXCEPTION 'fresh inside the bound %', v_code;
    END IF;
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26301 AND id = 26312) IS DISTINCT FROM 'sending' THEN
        RAISE EXCEPTION 'fresh sending was changed';
    END IF;
    v_code := vc.abandon_notification_sending(26301, 26313, 40);
    IF v_code IS NOT NULL THEN
        RAISE EXCEPTION 'cross owner abandon %', v_code;
    END IF;
    SELECT status, owner_user_id INTO v_status, v_owner
      FROM vc.notification_delivery WHERE id = 26313 AND owner_user_id = 26302;
    IF v_status IS DISTINCT FROM 'sending' OR v_owner IS DISTINCT FROM 26302 THEN
        RAISE EXCEPTION 'other owner became % %', v_status, v_owner;
    END IF;
    PERFORM vc.set_owner_context(26301, 'm263', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|26301|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m263',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    BEGIN
        PERFORM vc.schedule_notification_delivery(26301, 26311, 1, clock_timestamp() + interval '1 hour');
        RAISE EXCEPTION 'unknown was scheduled back to pending';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%already terminal%' THEN
                RAISE;
            END IF;
    END;
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26301 AND id = 26311) IS DISTINCT FROM 'unknown' THEN
        RAISE EXCEPTION 'schedule changed unknown';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.abandon_notification_sending(26301, 26312, 40);
    RAISE EXCEPTION 'worker executed abandon';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
