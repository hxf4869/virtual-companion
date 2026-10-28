-- W10-T1: inbox and notification isolation.
-- Cross-owner reads and claims see nothing. A delivery key
-- (event_id, channel, configured_target) cannot be inserted twice.
-- unknown and failed cannot replace each other. Deletion intent rejects
-- new inbox and delivery rows. Export contains inbox, channels and
-- deliveries and no credential material. Runtime roles cannot DML.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (21001, 'w10 owner'),
    (21002, 'w10 other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (21001, 21010, 'w10-card', true),
    (21001, 21020, 'w10-other-card', true),
    (21002, 21020, 'w10-card', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (21001, 21011, 21010, 'w10-chat-21001', 'COMPANION'),
    (21001, 21021, 21020, 'w10-chat-21021', 'COMPANION'),
    (21002, 21021, 21020, 'w10-chat-21002', 'COMPANION');

INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, body, status, normalization_status,
    event_id, deliverable, greeting_body, generation_outcome)
VALUES
    (21001, 21031, 21010, 'w10 topic body', 'BODY_READY', 'none',
     'w10-body', 'DELIVERABLE', 'w10 greeting text', 'BODY_READY'),
    (21001, 21032, 21010, 'w10 topic fail', 'BODY_READY', 'none',
     'w10-fail', 'DELIVERABLE', 'w10 fail greeting', 'BODY_READY'),
    (21001, 21033, 21010, 'w10 topic silent', 'SILENT', 'none',
     'w10-silent', 'NOT_DELIVERABLE', NULL, NULL);
SELECT setval(
    'vc.follow_up_id_seq',
    GREATEST(21040, (SELECT last_value FROM vc.follow_up_id_seq)));

CREATE TEMP TABLE w10_ids (
    key text PRIMARY KEY,
    event_id text,
    token text,
    id bigint
);
GRANT SELECT, INSERT, UPDATE ON w10_ids TO vc_api;

DO $$
BEGIN
    IF to_regprocedure('vc.export_v2_owner_metadata_v180_base(bigint)') IS NULL THEN
        RAISE EXCEPTION 'export_v2_owner_metadata_v180_base is missing';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vc'
          AND c.relname IN ('inbox_event', 'notification_channel', 'notification_delivery')
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
    ) OR (
        SELECT count(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vc'
          AND c.relname IN ('inbox_event', 'notification_channel', 'notification_delivery')
    ) <> 3 THEN
        RAISE EXCEPTION 'inbox tables missing ENABLE and FORCE ROW LEVEL SECURITY';
    END IF;
    IF (
        SELECT count(*) FROM pg_policies
        WHERE schemaname = 'vc'
          AND tablename IN ('inbox_event', 'notification_channel', 'notification_delivery')
          AND policyname = 'owner_isolation'
          AND cmd = 'ALL'
          AND roles @> ARRAY['vc_api', 'vc_worker', 'vc_job_coordinator', 'vc_dispatcher']::name[]
          AND cardinality(roles) = 4
    ) <> 3 THEN
        RAISE EXCEPTION 'inbox owner_isolation policy does not match follow_up';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'vc.notification_delivery'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) = 'UNIQUE (event_id, channel, configured_target)'
    ) THEN
        RAISE EXCEPTION 'delivery unique key must be (event_id, channel, configured_target)';
    END IF;
    IF (
        SELECT count(DISTINCT p.proname) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'vc'
          AND p.prosecdef
          AND p.proname IN (
              'put_notification_channel', 'create_inbox_event', 'create_notification_delivery',
              'record_notification_delivery_outcome', 'claim_inbox_event', 'ack_inbox_event',
              'expire_inbox_event', 'set_inbox_link_status', 'mark_inbox_read',
              'export_v2_owner_metadata')
    ) <> 10 OR EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'vc'
          AND p.proname IN (
              'put_notification_channel', 'create_inbox_event', 'create_notification_delivery',
              'record_notification_delivery_outcome', 'claim_inbox_event', 'ack_inbox_event',
              'expire_inbox_event', 'set_inbox_link_status', 'mark_inbox_read',
              'export_v2_owner_metadata')
          AND NOT p.prosecdef
    ) THEN
        RAISE EXCEPTION 'inbox write functions must be SECURITY DEFINER';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.role_table_grants
        WHERE table_schema = 'vc'
          AND table_name IN ('inbox_event', 'notification_channel', 'notification_delivery')
          AND grantee IN ('vc_api', 'vc_worker', 'vc_job_coordinator', 'vc_dispatcher', 'PUBLIC')
          AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
    ) THEN
        RAISE EXCEPTION 'runtime role has a direct inbox write grant';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.inbox_event) <> 0
       OR (SELECT count(*) FROM vc.notification_channel) <> 0
       OR (SELECT count(*) FROM vc.notification_delivery) <> 0 THEN
        RAISE EXCEPTION 'missing owner context returned inbox rows';
    END IF;
    BEGIN
        PERFORM vc.export_v2_owner_metadata(21001);
        RAISE EXCEPTION 'export without owner context returned';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM = 'export without owner context returned' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(21001, 'w10', encode(vc.hmac(convert_to('vc-owner-binding-v1|21001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w10', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_cancel bigint;
    v_expire bigint;
    v_consent bigint;
    v_lease bigint;
    v_event text;
    v_status text;
    v_count integer;
BEGIN
    v_cancel := vc.insert_follow_up(
        21001, 21010, NULL, NULL, NULL,
        'w10 waiting cancel', 'WAITING_HOST', 'none',
        NULL, false, NULL, NULL, NULL, NULL);
    v_expire := vc.insert_follow_up(
        21001, 21010, NULL, NULL, NULL,
        'w10 waiting expire', 'WAITING_HOST', 'none',
        NULL, false, NULL, NULL, NULL, NULL);
    v_consent := vc.insert_follow_up(
        21001, 21010, NULL, NULL, NULL,
        'w10 waiting consent', 'WAITING_HOST', 'none',
        NULL, false, NULL, NULL, NULL, NULL);
    v_lease := vc.insert_follow_up(
        21001, 21010, NULL, NULL, NULL,
        'w10 waiting lease', 'WAITING_HOST', 'none',
        NULL, false, NULL, NULL, NULL, NULL);
    INSERT INTO w10_ids(key, id, event_id)
    SELECT 'cancel', v_cancel, event_id FROM vc.follow_up WHERE owner_user_id = 21001 AND id = v_cancel;
    INSERT INTO w10_ids(key, id, event_id)
    SELECT 'expire', v_expire, event_id FROM vc.follow_up WHERE owner_user_id = 21001 AND id = v_expire;
    INSERT INTO w10_ids(key, id, event_id)
    SELECT 'consent', v_consent, event_id FROM vc.follow_up WHERE owner_user_id = 21001 AND id = v_consent;
    INSERT INTO w10_ids(key, id, event_id)
    SELECT 'lease', v_lease, event_id FROM vc.follow_up WHERE owner_user_id = 21001 AND id = v_lease;

    BEGIN
        PERFORM vc.put_notification_channel(
            21001, 'EMAIL', true, 'plain@example.test', 'secret-smtp', false, ARRAY[21010]::bigint[]);
        RAISE EXCEPTION 'plaintext credential accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification channel: credential must be field ciphertext' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.put_notification_channel(
            21001, 'FEISHU', true, 'https://hooks.example.test/w10',
            'enc2:default:1:w10plantedhook', false, ARRAY[21010]::bigint[]);
        RAISE EXCEPTION 'url target accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification channel: target must not carry a URL' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.put_notification_channel(
            21001, 'EMAIL', true, 'owner@example.test', 'enc2:default:1:w10plantedsmtp',
            false, ARRAY[21999]::bigint[]);
        RAISE EXCEPTION 'foreign character accepted on a channel';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification channel: relationship not found' THEN RAISE; END IF;
    END;

    PERFORM vc.put_notification_channel(
        21001, 'EMAIL', true, 'owner@example.test', 'enc2:default:1:w10plantedsmtp',
        false, ARRAY[21010]::bigint[]);
    PERFORM vc.put_notification_channel(
        21001, 'FEISHU', true, 'group-w10', 'enc2:default:1:w10plantedhook',
        false, ARRAY[21010]::bigint[]);
    PERFORM vc.put_notification_channel(
        21001, 'EMAIL', false, 'quiet@example.test', NULL, false, ARRAY[21010]::bigint[]);

    BEGIN
        PERFORM vc.create_inbox_event(21001, 'w10-silent', 21011, 'main', 1, NULL);
        RAISE EXCEPTION 'silent follow-up became an inbox event';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox event: follow-up is not ready' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_inbox_event(21001, 'w10-body', 21021, 'main', 1, NULL);
        RAISE EXCEPTION 'mismatched conversation became an inbox event';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox event: conversation not found' THEN RAISE; END IF;
    END;

    PERFORM vc.create_inbox_event(21001, 'w10-body', 21011, 'main', 1, NULL);
    PERFORM vc.create_inbox_event(21001, 'w10-fail', 21011, 'main', 1, NULL);
    PERFORM vc.create_inbox_event(21001, (SELECT event_id FROM w10_ids WHERE key = 'cancel'), 21011, 'main', 1, NULL);
    PERFORM vc.create_inbox_event(21001, (SELECT event_id FROM w10_ids WHERE key = 'expire'), 21011, 'main', 1, NULL);
    PERFORM vc.create_inbox_event(21001, (SELECT event_id FROM w10_ids WHERE key = 'consent'), 21011, 'main', 1, NULL);
    PERFORM vc.create_inbox_event(21001, (SELECT event_id FROM w10_ids WHERE key = 'lease'), 21011, 'main', 1, NULL);

    IF (SELECT body FROM vc.inbox_event WHERE event_id = 'w10-body') IS DISTINCT FROM 'w10 greeting text'
       OR (SELECT intent FROM vc.inbox_event WHERE event_id = 'w10-body') IS DISTINCT FROM 'BODY'
       OR (SELECT body FROM vc.inbox_event WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'lease')) IS NOT NULL
       OR (SELECT intent FROM vc.inbox_event WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'lease')) IS DISTINCT FROM 'WAITING_HOST' THEN
        RAISE EXCEPTION 'inbox copied the wrong body or intent';
    END IF;
    BEGIN
        PERFORM vc.create_inbox_event(21001, 'w10-body', 21011, 'main', 1, NULL);
        RAISE EXCEPTION 'duplicate inbox accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox event already exists' THEN RAISE; END IF;
    END;

    BEGIN
        PERFORM vc.create_notification_delivery(21001, 'w10-body', 'EMAIL', 'quiet@example.test');
        RAISE EXCEPTION 'disabled channel created a delivery';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: channel is not enabled for this character' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_notification_delivery(21001, 'w10-body', 'EMAIL', 'owner@example.test');
        RAISE EXCEPTION 'delivery without PUSH_NOTIFICATION accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: PUSH_NOTIFICATION consent is not current' THEN RAISE; END IF;
    END;

    PERFORM vc.record_consent(21001, 'PUSH_NOTIFICATION', 'w10-1', true);
    PERFORM vc.create_notification_delivery(21001, 'w10-body', 'EMAIL', 'owner@example.test');
    PERFORM vc.create_notification_delivery(21001, 'w10-body', 'FEISHU', 'group-w10');
    PERFORM vc.create_notification_delivery(21001, 'w10-fail', 'EMAIL', 'owner@example.test');
    PERFORM vc.create_notification_delivery(
        21001, (SELECT event_id FROM w10_ids WHERE key = 'cancel'), 'EMAIL', 'owner@example.test');
    PERFORM vc.create_notification_delivery(
        21001, (SELECT event_id FROM w10_ids WHERE key = 'expire'), 'FEISHU', 'group-w10');
    PERFORM vc.create_notification_delivery(
        21001, (SELECT event_id FROM w10_ids WHERE key = 'consent'), 'EMAIL', 'owner@example.test');

    BEGIN
        PERFORM vc.create_notification_delivery(21001, 'w10-body', 'EMAIL', 'owner@example.test');
        RAISE EXCEPTION 'duplicate delivery accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: duplicate target' THEN RAISE; END IF;
    END;

    IF vc.record_notification_delivery_outcome(
           21001,
           (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'EMAIL'),
           'accepted', NULL, 'smtp-accept-1') IS DISTINCT FROM 'accepted' THEN
        RAISE EXCEPTION 'accepted outcome was not stored';
    END IF;
    IF vc.record_notification_delivery_outcome(
           21001,
           (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'EMAIL'),
           'accepted', NULL, 'smtp-accept-1') IS DISTINCT FROM 'accepted'
       OR (SELECT attempt_count FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'EMAIL') <> 1 THEN
        RAISE EXCEPTION 'repeating accepted changed the attempt count';
    END IF;
    IF vc.record_notification_delivery_outcome(
           21001,
           (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'FEISHU'),
           'unknown', NULL, 'feishu-opaque-1') IS DISTINCT FROM 'unknown' THEN
        RAISE EXCEPTION 'unknown outcome was not stored';
    END IF;
    BEGIN
        PERFORM vc.record_notification_delivery_outcome(
            21001,
            (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'FEISHU'),
            'failed', 'SMTP_REJECTED', NULL);
        RAISE EXCEPTION 'failed replaced unknown';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: unknown and failed cannot be mixed' THEN RAISE; END IF;
    END;
    IF (SELECT status FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'FEISHU') IS DISTINCT FROM 'unknown' THEN
        RAISE EXCEPTION 'rejected mix changed the unknown delivery';
    END IF;
    BEGIN
        PERFORM vc.record_notification_delivery_outcome(
            21001,
            (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-fail' AND channel = 'EMAIL'),
            'unknown', 'SMTP_REJECTED', NULL);
        RAISE EXCEPTION 'unknown accepted a failure code';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: unknown and failed cannot be mixed' THEN RAISE; END IF;
    END;
    IF vc.record_notification_delivery_outcome(
           21001,
           (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-fail' AND channel = 'EMAIL'),
           'failed', 'SMTP_REJECTED', NULL) IS DISTINCT FROM 'failed' THEN
        RAISE EXCEPTION 'failed outcome was not stored';
    END IF;
    BEGIN
        PERFORM vc.record_notification_delivery_outcome(
            21001,
            (SELECT id FROM vc.notification_delivery WHERE event_id = 'w10-fail' AND channel = 'EMAIL'),
            'unknown', NULL, 'feishu-opaque-1');
        RAISE EXCEPTION 'unknown replaced failed';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: unknown and failed cannot be mixed' THEN RAISE; END IF;
    END;
    IF (SELECT status FROM vc.notification_delivery WHERE event_id = 'w10-fail' AND channel = 'EMAIL') IS DISTINCT FROM 'failed'
       OR (SELECT failure_code FROM vc.notification_delivery WHERE event_id = 'w10-fail' AND channel = 'EMAIL') IS DISTINCT FROM 'SMTP_REJECTED' THEN
        RAISE EXCEPTION 'rejected mix changed the failed delivery';
    END IF;

    IF NOT vc.cancel_follow_up(21001, (SELECT id FROM w10_ids WHERE key = 'cancel')) THEN
        RAISE EXCEPTION 'cancel follow-up returned false';
    END IF;
    SELECT status INTO v_status FROM vc.notification_delivery
     WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'cancel');
    IF v_status IS DISTINCT FROM 'stopped'
       OR (SELECT stopped_reason FROM vc.notification_delivery
            WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'cancel')) IS DISTINCT FROM 'cancelled' THEN
        RAISE EXCEPTION 'cancel did not stop the unsent delivery';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.notification_delivery
        WHERE event_id IN (
            (SELECT event_id FROM w10_ids WHERE key = 'expire'),
            (SELECT event_id FROM w10_ids WHERE key = 'consent'))
          AND status IS DISTINCT FROM 'pending'
    ) OR EXISTS (
        SELECT 1 FROM vc.notification_delivery
        WHERE event_id = 'w10-body' AND status NOT IN ('accepted', 'unknown')
    ) OR EXISTS (
        SELECT 1 FROM vc.notification_delivery
        WHERE event_id = 'w10-fail' AND status IS DISTINCT FROM 'failed'
    ) THEN
        RAISE EXCEPTION 'cancel stopped a delivery for another event';
    END IF;
    BEGIN
        PERFORM vc.create_notification_delivery(
            21001, (SELECT event_id FROM w10_ids WHERE key = 'cancel'), 'FEISHU', 'group-w10');
        RAISE EXCEPTION 'cancelled follow-up created a delivery';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: follow-up is cancelled' THEN RAISE; END IF;
    END;

    v_count := vc.expire_inbox_event(21001, (SELECT event_id FROM w10_ids WHERE key = 'expire'));
    IF v_count <> 1
       OR (SELECT status FROM vc.notification_delivery
            WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'expire')) IS DISTINCT FROM 'stopped'
       OR (SELECT stopped_reason FROM vc.notification_delivery
            WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'expire')) IS DISTINCT FROM 'expired' THEN
        RAISE EXCEPTION 'expiry did not stop only the unsent delivery';
    END IF;
    IF (SELECT status FROM vc.notification_delivery
         WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'consent')) IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'expiry stopped the consent delivery';
    END IF;
    BEGIN
        PERFORM vc.create_notification_delivery(
            21001, (SELECT event_id FROM w10_ids WHERE key = 'expire'), 'EMAIL', 'owner@example.test');
        RAISE EXCEPTION 'expired inbox created a delivery';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: inbox event expired' THEN RAISE; END IF;
    END;

    PERFORM vc.record_consent(21001, 'PUSH_NOTIFICATION', 'w10-1', false);
    IF (SELECT status FROM vc.notification_delivery
         WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'consent')) IS DISTINCT FROM 'stopped'
       OR (SELECT stopped_reason FROM vc.notification_delivery
            WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'consent')) IS DISTINCT FROM 'consent_withdrawn' THEN
        RAISE EXCEPTION 'consent withdrawal did not stop the unsent delivery';
    END IF;
    IF (SELECT status FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'EMAIL') IS DISTINCT FROM 'accepted'
       OR (SELECT status FROM vc.notification_delivery WHERE event_id = 'w10-body' AND channel = 'FEISHU') IS DISTINCT FROM 'unknown'
       OR (SELECT status FROM vc.notification_delivery WHERE event_id = 'w10-fail' AND channel = 'EMAIL') IS DISTINCT FROM 'failed'
       OR (SELECT stopped_reason FROM vc.notification_delivery
            WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'cancel')) IS DISTINCT FROM 'cancelled'
       OR (SELECT stopped_reason FROM vc.notification_delivery
            WHERE event_id = (SELECT event_id FROM w10_ids WHERE key = 'expire')) IS DISTINCT FROM 'expired' THEN
        RAISE EXCEPTION 'consent withdrawal rewrote a finished delivery';
    END IF;
    BEGIN
        PERFORM vc.create_notification_delivery(21001, 'w10-body', 'EMAIL', 'owner@example.test');
        RAISE EXCEPTION 'withdrawn consent created a delivery';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: PUSH_NOTIFICATION consent is not current' THEN RAISE; END IF;
    END;

    SELECT c.out_token INTO v_event FROM vc.claim_inbox_event(
        21001, (SELECT event_id FROM w10_ids WHERE key = 'lease'), 30) c;
    UPDATE w10_ids SET token = v_event WHERE key = 'lease';
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.inbox_event
   SET lease_expires_at = clock_timestamp() - interval '1 second'
 WHERE owner_user_id = 21001
   AND event_id = (SELECT event_id FROM w10_ids WHERE key = 'lease');

BEGIN;
SELECT vc.set_owner_context(21001, 'w10-lease', encode(vc.hmac(convert_to('vc-owner-binding-v1|21001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w10-lease', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_event text;
    v_token text;
    v_doc jsonb;
    v_keys jsonb;
    v_expected jsonb := '["bindings","capturedAt","consents","evidence","extractionResults","followUps","inbox","instances","memoryAutoSave","memoryTimes","notificationChannels","notificationDeliveries","proactivePolicies","reminders","sources","sourceTimes","storyRuns","summaries","summarySources","tasks"]'::jsonb;
BEGIN
    v_event := (SELECT event_id FROM w10_ids WHERE key = 'lease');
    v_token := (SELECT token FROM w10_ids WHERE key = 'lease');
    BEGIN
        PERFORM vc.ack_inbox_event(21001, v_event, v_token, 'msg-lease', 1);
        RAISE EXCEPTION 'expired lease ack accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox lease expired' THEN RAISE; END IF;
    END;
    IF (SELECT st_delivered FROM vc.inbox_event WHERE event_id = v_event) THEN
        RAISE EXCEPTION 'expired ack marked the inbox delivered';
    END IF;
    BEGIN
        PERFORM vc.claim_inbox_event(21001, v_event, 0);
        RAISE EXCEPTION 'zero lease seconds accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox lease seconds are invalid' THEN RAISE; END IF;
    END;
    IF (SELECT lease_token FROM vc.inbox_event WHERE event_id = v_event) IS DISTINCT FROM v_token
       OR (SELECT st_delivered FROM vc.inbox_event WHERE event_id = v_event) THEN
        RAISE EXCEPTION 'invalid lease seconds replaced the expired lease';
    END IF;

    SELECT c.out_token INTO v_token FROM vc.claim_inbox_event(21001, v_event, 30) c;
    IF NOT vc.ack_inbox_event(21001, v_event, v_token, 'msg-lease', 1) THEN
        RAISE EXCEPTION 'fresh lease ack returned false';
    END IF;
    IF (SELECT st_delivered FROM vc.inbox_event WHERE event_id = v_event) IS NOT TRUE
       OR (SELECT link_status FROM vc.inbox_event WHERE event_id = v_event) IS DISTINCT FROM 'present'
       OR (SELECT read_at FROM vc.inbox_event WHERE event_id = v_event) IS NOT NULL
       OR (SELECT st_message_id FROM vc.inbox_event WHERE event_id = v_event) IS DISTINCT FROM 'msg-lease'
       OR (SELECT lease_token FROM vc.inbox_event WHERE event_id = v_event) IS NOT NULL THEN
        RAISE EXCEPTION 'ack mixed link status, read or lease into delivery';
    END IF;

    SELECT c.out_token INTO v_token FROM vc.claim_inbox_event(21001, 'w10-body', 60) c;
    IF NOT vc.ack_inbox_event(21001, 'w10-body', v_token, 'msg-body', 3) THEN
        RAISE EXCEPTION 'body ack returned false';
    END IF;
    PERFORM vc.set_inbox_link_status(21001, 'w10-body', 'removed');
    IF (SELECT st_delivered FROM vc.inbox_event WHERE event_id = 'w10-body') IS NOT TRUE
       OR (SELECT read_at FROM vc.inbox_event WHERE event_id = 'w10-body') IS NOT NULL
       OR (SELECT link_status FROM vc.inbox_event WHERE event_id = 'w10-body') IS DISTINCT FROM 'removed' THEN
        RAISE EXCEPTION 'link status rewrote delivery or read';
    END IF;
    PERFORM vc.mark_inbox_read(21001, 'w10-body');
    IF (SELECT read_at FROM vc.inbox_event WHERE event_id = 'w10-body') IS NULL
       OR (SELECT link_status FROM vc.inbox_event WHERE event_id = 'w10-body') IS DISTINCT FROM 'removed'
       OR (SELECT st_delivered FROM vc.inbox_event WHERE event_id = 'w10-body') IS NOT TRUE THEN
        RAISE EXCEPTION 'in-app read rewrote link status or delivery';
    END IF;

    SELECT c.out_token INTO v_token FROM vc.claim_inbox_event(21001, 'w10-body', 60) c;
    INSERT INTO w10_ids(key, event_id, token) VALUES ('body', 'w10-body', v_token);
    BEGIN
        PERFORM vc.claim_inbox_event(21001, 'w10-body', 60);
        RAISE EXCEPTION 'live lease was replaced';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox lease is held' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.ack_inbox_event(21001, 'w10-body', 'not-the-lease', 'msg-body', 4);
        RAISE EXCEPTION 'wrong lease token was accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'inbox lease token does not match' THEN RAISE; END IF;
    END;

    BEGIN
        PERFORM vc.export_v2_owner_metadata_v180_base(21001);
        RAISE EXCEPTION 'runtime role called the export base';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM vc.stop_unsent_notification_deliveries(21001, 'w10-body', 'cancelled');
        RAISE EXCEPTION 'runtime role stopped deliveries directly';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    v_doc := vc.export_v2_owner_metadata(21001);
    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_keys FROM jsonb_object_keys(v_doc) AS k;
    IF v_keys IS DISTINCT FROM (
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_array_elements_text(v_expected) AS k
    ) THEN
        RAISE EXCEPTION 'export keys changed: %', v_keys;
    END IF;
    IF v_doc::text LIKE '%enc2:default:1:w10plantedsmtp%'
       OR v_doc::text LIKE '%enc2:default:1:w10plantedhook%'
       OR v_doc::text LIKE '%secret-smtp%' THEN
        RAISE EXCEPTION 'export leaked field ciphertext';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_doc->'inbox') AS item, jsonb_object_keys(item) AS k
         WHERE lower(k) ~ '(credential|secret|password|webhook|signature|token|lease)'
    ) OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_doc->'notificationChannels') AS item, jsonb_object_keys(item) AS k
         WHERE lower(k) ~ '(credential|secret|password|webhook|signature|token|lease)'
    ) OR EXISTS (
        SELECT 1
          FROM jsonb_array_elements(v_doc->'notificationDeliveries') AS item, jsonb_object_keys(item) AS k
         WHERE lower(k) ~ '(credential|secret|password|webhook|signature|token|lease)'
    ) THEN
        RAISE EXCEPTION 'export included a credential or lease key';
    END IF;
    IF jsonb_array_length(v_doc->'inbox') <> 6
       OR jsonb_array_length(v_doc->'notificationChannels') <> 3
       OR jsonb_array_length(v_doc->'notificationDeliveries') <> 6 THEN
        RAISE EXCEPTION 'export dropped an inbox, channel or delivery';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_doc->'inbox') e
        WHERE e->>'eventId' = 'w10-body'
          AND e->>'persisted' = 'true'
          AND e->>'stDelivered' = 'true'
          AND e->>'intent' = 'BODY'
          AND e->>'body' = 'w10 greeting text'
          AND e->>'linkStatus' = 'removed'
          AND e->>'read' = 'true'
          AND e->>'messageId' = 'msg-body'
          AND e->>'messageRevision' = '3'
          AND e->>'relationshipId' = '21010'
          AND e->>'conversationId' = '21011'
          AND e->>'branch' = 'main'
    ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_doc->'inbox') e
        WHERE e->>'eventId' = v_event
          AND e->>'stDelivered' = 'true'
          AND e->>'intent' = 'WAITING_HOST'
          AND e->'body' = 'null'::jsonb
          AND e->>'linkStatus' = 'present'
          AND e->>'read' = 'false'
          AND e->'readAt' = 'null'::jsonb
    ) THEN
        RAISE EXCEPTION 'export mixed persisted, delivered, read and link facts';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_doc->'notificationChannels') c
        WHERE c->>'channel' = 'EMAIL'
          AND c->>'configuredTarget' = 'owner@example.test'
          AND c->>'enabled' = 'true'
          AND c->>'previewBody' = 'false'
          AND c->'relationshipIds' @> '[21010]'::jsonb
    ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_doc->'notificationDeliveries') d
        WHERE d->>'eventId' = 'w10-body' AND d->>'channel' = 'EMAIL'
          AND d->>'status' = 'accepted' AND d->>'attemptCount' = '1'
          AND d->>'correlationId' = 'smtp-accept-1' AND d->'failureCode' = 'null'::jsonb
    ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_doc->'notificationDeliveries') d
        WHERE d->>'eventId' = 'w10-body' AND d->>'channel' = 'FEISHU'
          AND d->>'status' = 'unknown' AND d->>'correlationId' = 'feishu-opaque-1'
    ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_doc->'notificationDeliveries') d
        WHERE d->>'eventId' = 'w10-fail' AND d->>'status' = 'failed'
          AND d->>'failureCode' = 'SMTP_REJECTED'
    ) THEN
        RAISE EXCEPTION 'export omitted channel or delivery state';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.notification_channel
        WHERE credential_cipher = 'enc2:default:1:w10plantedsmtp'
    ) OR NOT EXISTS (
        SELECT 1 FROM vc.notification_channel
        WHERE credential_cipher = 'enc2:default:1:w10plantedhook'
    ) THEN
        RAISE EXCEPTION 'field ciphertext was not stored';
    END IF;

    BEGIN
        INSERT INTO vc.inbox_event(
            owner_user_id, id, event_id, relationship_id, conversation_id, intent)
        VALUES (21001, 1, 'w10-direct', 21010, 21011, 'WAITING_HOST');
        RAISE EXCEPTION 'direct inbox insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE vc.inbox_event SET link_status = 'invalidated';
        RAISE EXCEPTION 'direct inbox update accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM vc.inbox_event;
        RAISE EXCEPTION 'direct inbox delete accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO vc.notification_channel(
            owner_user_id, id, channel, configured_target)
        VALUES (21001, 1, 'EMAIL', 'direct@example.test');
        RAISE EXCEPTION 'direct channel insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE vc.notification_channel SET enabled = false;
        RAISE EXCEPTION 'direct channel update accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM vc.notification_channel;
        RAISE EXCEPTION 'direct channel delete accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO vc.notification_delivery(
            owner_user_id, id, event_id, channel, configured_target)
        VALUES (21001, 1, 'w10-body', 'EMAIL', 'direct@example.test');
        RAISE EXCEPTION 'direct delivery insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE vc.notification_delivery SET status = 'stopped';
        RAISE EXCEPTION 'direct delivery update accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM vc.notification_delivery;
        RAISE EXCEPTION 'direct delivery delete accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(21002, 'w10-other', encode(vc.hmac(convert_to('vc-owner-binding-v1|21002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w10-other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_doc jsonb;
BEGIN
    IF (SELECT count(*) FROM vc.inbox_event) <> 0
       OR (SELECT count(*) FROM vc.notification_channel) <> 0
       OR (SELECT count(*) FROM vc.notification_delivery) <> 0 THEN
        RAISE EXCEPTION 'owner 2 read owner 1 inbox rows';
    END IF;
    BEGIN
        PERFORM vc.claim_inbox_event(21001, 'w10-body', 30);
        RAISE EXCEPTION 'cross owner claim accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_inbox_event(21001, 'w10-body', 21011, 'main', 1, NULL);
        RAISE EXCEPTION 'cross owner inbox write accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_notification_delivery(21001, 'w10-body', 'EMAIL', 'owner@example.test');
        RAISE EXCEPTION 'cross owner delivery write accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
    v_doc := vc.export_v2_owner_metadata(21002);
    IF jsonb_array_length(v_doc->'inbox') <> 0
       OR jsonb_array_length(v_doc->'notificationChannels') <> 0
       OR jsonb_array_length(v_doc->'notificationDeliveries') <> 0
       OR v_doc::text LIKE '%w10 greeting text%'
       OR v_doc::text LIKE '%enc2:default:1:w10plantedsmtp%' THEN
        RAISE EXCEPTION 'other owner export leaked inbox or credentials';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_token text;
BEGIN
    SELECT lease_token INTO v_token
      FROM vc.inbox_event
     WHERE owner_user_id = 21001 AND event_id = 'w10-body';
    IF v_token IS DISTINCT FROM (SELECT token FROM w10_ids WHERE key = 'body') THEN
        RAISE EXCEPTION 'cross owner claim changed the lease';
    END IF;
    BEGIN
        PERFORM vc.stop_unsent_notification_deliveries(21001, NULL, 'nope');
        RAISE EXCEPTION 'bad stop reason accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'notification delivery: stop reason is invalid' THEN RAISE; END IF;
    END;
END $$;

INSERT INTO vc.account_deletion_intent(account_id, username_digest, status, st_status)
VALUES (21001, lpad('210', 64, '0'), 'REQUESTED', 'COMPLETED');

BEGIN;
SELECT vc.set_owner_context(21001, 'w10-delete', encode(vc.hmac(convert_to('vc-owner-binding-v1|21001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w10-delete', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    v_id := vc.insert_follow_up(
        21001, 21010, NULL, NULL, NULL,
        'w10 waiting during deletion', 'WAITING_HOST', 'none',
        NULL, false, NULL, NULL, NULL, NULL);
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'deletion blocked an existing follow-up insert';
    END IF;
    BEGIN
        PERFORM vc.create_inbox_event(
            21001,
            (SELECT event_id FROM vc.follow_up WHERE owner_user_id = 21001 AND id = v_id),
            21011, 'main', 1, NULL);
        RAISE EXCEPTION 'deletion allowed a new inbox event';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_notification_delivery(21001, 'w10-missing', 'EMAIL', 'owner@example.test');
        RAISE EXCEPTION 'deletion allowed a new delivery';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    BEGIN
        INSERT INTO vc.inbox_event(
            owner_user_id, id, event_id, relationship_id, conversation_id, intent)
        VALUES (21001, 21099, 'w10-body', 21010, 21011, 'WAITING_HOST');
        RAISE EXCEPTION 'deletion trigger allowed a direct inbox insert';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    BEGIN
        INSERT INTO vc.notification_delivery(
            owner_user_id, id, event_id, channel, configured_target)
        VALUES (21001, 21099, 'w10-body', 'EMAIL', 'direct-delete@example.test');
        RAISE EXCEPTION 'deletion trigger allowed a direct delivery insert';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
END $$;
