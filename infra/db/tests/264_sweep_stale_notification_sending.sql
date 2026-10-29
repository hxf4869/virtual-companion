-- W16 review: sweep_stale_notification_sending is the worker entry. It
-- marks sending rows older than the caller's bound as unknown and leaves
-- younger sending rows, pending rows and accepted rows. Both owners are
-- swept by the same rule; a row keeps its owner. The function is granted
-- to vc_api and vc_worker only. Direct table updates stay denied, and
-- schedule cannot put unknown back to pending.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (26401, 'w16e sweep'), (26402, 'w16e sweep other')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (26401, 'w16e-264-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
       (26402, 'w16e-264-other', 'synthetic', 'USER', 'ACTIVE', 'other')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (26401, 10, 'persona-a', true), (26402, 10, 'persona-b', true)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES
    (26401, 26421, 10, 'w16e', '26400000-0000-4000-8000-000000002641', 'COMPANION', 'PRESENT', false),
    (26402, 26422, 10, 'w16e', '26400000-0000-4000-8000-000000002642', 'COMPANION', 'PRESENT', false)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, body, status, normalization_status,
    event_id, deliverable, greeting_body, generation_outcome)
VALUES
    (26401, 26431, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-264-stale', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26401, 26432, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-264-fresh', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26401, 26433, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-264-pending', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26401, 26434, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-264-accepted', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26402, 26435, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-264-other-stale', 'DELIVERABLE', '下周见', 'BODY_READY'),
    (26402, 26436, 10, 'topic', 'BODY_READY', 'none', 'fu-w16e-264-other-fresh', 'DELIVERABLE', '下周见', 'BODY_READY');
INSERT INTO vc.inbox_event(
    owner_user_id, id, event_id, relationship_id, conversation_id, intent, body)
VALUES
    (26401, 26441, 'fu-w16e-264-stale', 10, 26421, 'BODY', '下周见'),
    (26401, 26442, 'fu-w16e-264-fresh', 10, 26421, 'BODY', '下周见'),
    (26401, 26443, 'fu-w16e-264-pending', 10, 26421, 'BODY', '下周见'),
    (26401, 26444, 'fu-w16e-264-accepted', 10, 26421, 'BODY', '下周见'),
    (26402, 26445, 'fu-w16e-264-other-stale', 10, 26422, 'BODY', '下周见'),
    (26402, 26446, 'fu-w16e-264-other-fresh', 10, 26422, 'BODY', '下周见');
INSERT INTO vc.notification_delivery(
    owner_user_id, id, event_id, channel, configured_target)
VALUES
    (26401, 26411, 'fu-w16e-264-stale', 'EMAIL', 'stale@example.test'),
    (26401, 26412, 'fu-w16e-264-fresh', 'EMAIL', 'fresh@example.test'),
    (26401, 26413, 'fu-w16e-264-pending', 'EMAIL', 'pending@example.test'),
    (26401, 26414, 'fu-w16e-264-accepted', 'EMAIL', 'accepted@example.test'),
    (26402, 26415, 'fu-w16e-264-other-stale', 'EMAIL', 'other-stale@example.test'),
    (26402, 26416, 'fu-w16e-264-other-fresh', 'EMAIL', 'other-fresh@example.test');
UPDATE vc.notification_delivery
   SET status = 'sending', updated_at = clock_timestamp() - interval '2 minutes'
 WHERE (owner_user_id, id) IN ((26401, 26411), (26402, 26415));
UPDATE vc.notification_delivery
   SET status = 'sending', updated_at = clock_timestamp() - interval '30 seconds'
 WHERE (owner_user_id, id) IN ((26401, 26412), (26402, 26416));
UPDATE vc.notification_delivery
   SET updated_at = clock_timestamp() - interval '2 minutes'
 WHERE owner_user_id = 26401 AND id = 26413;
UPDATE vc.notification_delivery
   SET status = 'accepted', correlation_id = 'n.26414'
 WHERE owner_user_id = 26401 AND id = 26414;

DO $$
BEGIN
    IF has_function_privilege('public', 'vc.sweep_stale_notification_sending(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public can sweep notification sending';
    END IF;
    IF NOT has_function_privilege('vc_api', 'vc.sweep_stale_notification_sending(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api cannot sweep notification sending';
    END IF;
    IF NOT has_function_privilege('vc_worker', 'vc.sweep_stale_notification_sending(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker cannot sweep notification sending';
    END IF;
    IF has_function_privilege('vc_dispatcher', 'vc.sweep_stale_notification_sending(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_dispatcher can sweep notification sending';
    END IF;
    IF has_function_privilege('vc_job_coordinator', 'vc.sweep_stale_notification_sending(integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_job_coordinator can sweep notification sending';
    END IF;
END $$;

DO $$
BEGIN
    BEGIN
        PERFORM vc.sweep_stale_notification_sending(0);
        RAISE EXCEPTION 'zero bound was accepted';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%must be positive%' THEN
                RAISE;
            END IF;
    END;
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26411) IS DISTINCT FROM 'sending' THEN
        RAISE EXCEPTION 'zero bound changed a row';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE v_n integer;
BEGIN
    SELECT vc.sweep_stale_notification_sending(40) INTO v_n;
    IF v_n IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'sweep count %', v_n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_status text;
    v_attempts integer;
    v_owner bigint;
    v_failure text;
    v_next timestamptz;
BEGIN
    SELECT status, attempt_count, failure_code, next_attempt_at, owner_user_id
      INTO v_status, v_attempts, v_failure, v_next, v_owner
      FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26411;
    IF v_status IS DISTINCT FROM 'unknown' OR v_attempts IS DISTINCT FROM 1
       OR v_failure IS NOT NULL OR v_next IS NOT NULL OR v_owner IS DISTINCT FROM 26401 THEN
        RAISE EXCEPTION 'owner stale % % % % %', v_status, v_attempts, v_failure, v_next, v_owner;
    END IF;
    SELECT status, attempt_count, owner_user_id
      INTO v_status, v_attempts, v_owner
      FROM vc.notification_delivery WHERE owner_user_id = 26402 AND id = 26415;
    IF v_status IS DISTINCT FROM 'unknown' OR v_attempts IS DISTINCT FROM 1 OR v_owner IS DISTINCT FROM 26402 THEN
        RAISE EXCEPTION 'other stale % % %', v_status, v_attempts, v_owner;
    END IF;
    IF (SELECT status || ':' || attempt_count::text || ':' || owner_user_id::text
          FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26412)
       IS DISTINCT FROM 'sending:0:26401' THEN
        RAISE EXCEPTION 'fresh sending was swept';
    END IF;
    IF (SELECT status || ':' || owner_user_id::text
          FROM vc.notification_delivery WHERE owner_user_id = 26402 AND id = 26416)
       IS DISTINCT FROM 'sending:26402' THEN
        RAISE EXCEPTION 'other fresh sending was swept';
    END IF;
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26413) IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'pending was swept';
    END IF;
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26414) IS DISTINCT FROM 'accepted' THEN
        RAISE EXCEPTION 'accepted was swept';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE v_n integer;
BEGIN
    SELECT vc.sweep_stale_notification_sending(40) INTO v_n;
    IF v_n IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'second sweep %', v_n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF (SELECT attempt_count FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26411) IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'second sweep incremented the attempt';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(26401, 'm264', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|26401|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m264',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.schedule_notification_delivery(26401, 26411, 1, clock_timestamp() + interval '1 hour');
    RAISE EXCEPTION 'unknown was scheduled back to pending';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%already terminal%' AND SQLERRM NOT LIKE '%unknown was scheduled%' THEN
            RAISE;
        END IF;
        IF SQLERRM LIKE '%unknown was scheduled%' THEN
            RAISE;
        END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26401 AND id = 26411) IS DISTINCT FROM 'unknown' THEN
        RAISE EXCEPTION 'schedule changed unknown';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(26401, 'm264b', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|26401|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m264b',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_own integer; v_other integer;
BEGIN
    SELECT count(*) INTO v_own FROM vc.notification_delivery WHERE owner_user_id = 26401;
    SELECT count(*) INTO v_other FROM vc.notification_delivery WHERE owner_user_id = 26402;
    IF v_own IS DISTINCT FROM 4 OR v_other IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'visible own % other %', v_own, v_other;
    END IF;
    BEGIN
        UPDATE vc.notification_delivery SET status = 'pending' WHERE owner_user_id = 26401 AND id = 26411;
        RAISE EXCEPTION 'direct update ran';
    EXCEPTION
        WHEN insufficient_privilege THEN
            NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_n integer;
BEGIN
    SELECT vc.sweep_stale_notification_sending(40) INTO v_n;
    IF v_n IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'api sweep %', v_n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
