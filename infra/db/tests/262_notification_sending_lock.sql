-- W16 review: sending is a legal in-flight status. Push withdrawal stops
-- pending rows and leaves a row already marked sending. Recording an
-- outcome from sending is accepted.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (26201, 'w16e sending') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (26201, 'w16e-262-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (26201, 10, 'persona-a', true)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES (
    26201, 26221, 10, 'w16e',
    '26200000-0000-4000-8000-000000002621', 'COMPANION', 'PRESENT', false)
ON CONFLICT (owner_user_id, id) DO NOTHING;
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, body, status, normalization_status,
    event_id, deliverable, greeting_body, generation_outcome)
VALUES (
    26201, 26231, 10, 'topic', 'BODY_READY', 'none',
    'fu-w16e-262', 'DELIVERABLE', '下周见', 'BODY_READY');
INSERT INTO vc.inbox_event(
    owner_user_id, id, event_id, relationship_id, conversation_id, intent, body)
VALUES (26201, 26211, 'fu-w16e-262', 10, 26221, 'BODY', '下周见');
INSERT INTO vc.notification_delivery(
    owner_user_id, id, event_id, channel, configured_target)
VALUES
    (26201, 26201, 'fu-w16e-262', 'EMAIL', 'pending@example.test'),
    (26201, 26202, 'fu-w16e-262', 'EMAIL', 'sending@example.test');
UPDATE vc.notification_delivery
   SET status = 'sending'
 WHERE owner_user_id = 26201 AND id = 26202;

DO $$
DECLARE
    v_pending text;
    v_sending text;
    v_reason text;
    v_outcome text;
BEGIN
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26201 AND id = 26202) IS DISTINCT FROM 'sending' THEN
        RAISE EXCEPTION 'sending status was rejected';
    END IF;
    PERFORM vc.set_owner_context(26201, 'm262', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|26201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m262',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    PERFORM vc.record_consent(26201, 'PUSH_NOTIFICATION', 'w16e-off', false);
    SELECT status, stopped_reason INTO v_pending, v_reason
      FROM vc.notification_delivery WHERE owner_user_id = 26201 AND id = 26201;
    SELECT status INTO v_sending
      FROM vc.notification_delivery WHERE owner_user_id = 26201 AND id = 26202;
    IF v_pending IS DISTINCT FROM 'stopped' OR v_reason IS DISTINCT FROM 'consent_withdrawn' THEN
        RAISE EXCEPTION 'pending after withdrawal % %', v_pending, v_reason;
    END IF;
    IF v_sending IS DISTINCT FROM 'sending' THEN
        RAISE EXCEPTION 'sending row changed to %', v_sending;
    END IF;
    v_outcome := vc.record_notification_delivery_outcome(26201, 26202, 'accepted', NULL, 'n.26202');
    IF v_outcome IS DISTINCT FROM 'accepted' THEN
        RAISE EXCEPTION 'record from sending returned %', v_outcome;
    END IF;
    IF (SELECT status FROM vc.notification_delivery WHERE owner_user_id = 26201 AND id = 26202) IS DISTINCT FROM 'accepted' THEN
        RAISE EXCEPTION 'sending was not recorded as accepted';
    END IF;
END $$;
