-- W10-T1: inbox, notification channels and deliveries.
-- Writes go through SECURITY DEFINER functions that call go_assert_owner.
-- Channel secrets stay in credential_cipher (enc2 field ciphertext) and are
-- omitted from export_v2_owner_metadata. The previous export body is renamed
-- to export_v2_owner_metadata_v180_base; that name is not used by V144–V170.
-- The delivery unique key is (owner_user_id, event_id, channel,
-- configured_target). Follow-up event ids are unique per owner only, so the
-- same event id, channel and target may exist for two owners.
-- Unsent means status pending. accepted, failed and unknown are terminal and
-- are not rewritten when a follow-up is cancelled, an inbox expires, or
-- PUSH_NOTIFICATION is withdrawn.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE vc.inbox_event_id_seq AS bigint;
CREATE SEQUENCE vc.notification_channel_id_seq AS bigint;
CREATE SEQUENCE vc.notification_delivery_id_seq AS bigint;

CREATE TABLE vc.inbox_event (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    event_id text NOT NULL,
    relationship_id bigint NOT NULL,
    conversation_id bigint NOT NULL,
    branch text,
    source_revision bigint,
    intent text NOT NULL,
    body text,
    st_delivered boolean NOT NULL DEFAULT false,
    st_message_id text,
    st_message_revision bigint,
    link_status text NOT NULL DEFAULT 'present',
    read_at timestamptz,
    lease_token text,
    lease_expires_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    CONSTRAINT inbox_event_owner_event UNIQUE (owner_user_id, event_id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, event_id)
        REFERENCES vc.follow_up(owner_user_id, event_id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT inbox_event_event_id CHECK (event_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
    CONSTRAINT inbox_event_branch CHECK (branch IS NULL OR char_length(branch) BETWEEN 1 AND 128),
    CONSTRAINT inbox_event_source_revision CHECK (source_revision IS NULL OR source_revision >= 0),
    CONSTRAINT inbox_event_intent CHECK (intent IN ('BODY', 'WAITING_HOST')),
    CONSTRAINT inbox_event_body_shape CHECK (
        (intent = 'WAITING_HOST' AND body IS NULL)
        OR (
            intent = 'BODY'
            AND body IS NOT NULL
            AND char_length(body) BETWEEN 1 AND 4000
            AND btrim(body) <> '')),
    CONSTRAINT inbox_event_link CHECK (link_status IN ('present', 'removed', 'invalidated')),
    CONSTRAINT inbox_event_message CHECK (
        (st_message_id IS NULL OR (
            char_length(st_message_id) BETWEEN 1 AND 128 AND btrim(st_message_id) <> ''))
        AND (st_message_revision IS NULL OR st_message_revision >= 0)),
    CONSTRAINT inbox_event_delivered_shape CHECK (
        (st_delivered = (st_message_id IS NOT NULL AND st_message_revision IS NOT NULL))
        AND ((st_message_id IS NULL) = (st_message_revision IS NULL))),
    CONSTRAINT inbox_event_lease_shape CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE vc.notification_channel (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    channel text NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    configured_target text NOT NULL,
    credential_cipher text,
    preview_body boolean NOT NULL DEFAULT false,
    relationship_ids bigint[] NOT NULL DEFAULT '{}',
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    CONSTRAINT notification_channel_owner_target UNIQUE (owner_user_id, channel, configured_target),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT notification_channel_kind CHECK (channel IN ('EMAIL', 'FEISHU')),
    CONSTRAINT notification_channel_target CHECK (
        char_length(configured_target) BETWEEN 1 AND 320
        AND btrim(configured_target) <> ''
        AND configured_target !~* 'https?://'),
    CONSTRAINT notification_channel_credential CHECK (
        credential_cipher IS NULL OR credential_cipher ~ '^enc2:[^:]+:[1-9][0-9]*:.+$'),
    CONSTRAINT notification_channel_relationships CHECK (cardinality(relationship_ids) BETWEEN 0 AND 32)
);

CREATE TABLE vc.notification_delivery (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    event_id text NOT NULL,
    channel text NOT NULL,
    configured_target text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    attempt_count integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz,
    correlation_id text,
    failure_code text,
    stopped_reason text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    CONSTRAINT notification_delivery_event_channel_target UNIQUE (owner_user_id, event_id, channel, configured_target),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, event_id)
        REFERENCES vc.inbox_event(owner_user_id, event_id) ON DELETE CASCADE,
    CONSTRAINT notification_delivery_channel CHECK (channel IN ('EMAIL', 'FEISHU')),
    CONSTRAINT notification_delivery_target CHECK (
        char_length(configured_target) BETWEEN 1 AND 320 AND btrim(configured_target) <> ''),
    CONSTRAINT notification_delivery_status CHECK (
        status IN ('pending', 'accepted', 'failed', 'unknown', 'stopped')),
    CONSTRAINT notification_delivery_attempts CHECK (attempt_count >= 0),
    CONSTRAINT notification_delivery_correlation CHECK (
        correlation_id IS NULL OR correlation_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
    CONSTRAINT notification_delivery_failure CHECK (
        failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,64}$'),
    CONSTRAINT notification_delivery_stopped_reason CHECK (
        stopped_reason IS NULL OR stopped_reason IN ('cancelled', 'expired', 'consent_withdrawn')),
    CONSTRAINT notification_delivery_failed_shape CHECK ((status = 'failed') = (failure_code IS NOT NULL)),
    CONSTRAINT notification_delivery_unknown_shape CHECK (status <> 'unknown' OR failure_code IS NULL),
    CONSTRAINT notification_delivery_accepted_shape CHECK (
        status <> 'accepted' OR (correlation_id IS NOT NULL AND failure_code IS NULL)),
    CONSTRAINT notification_delivery_stopped_shape CHECK ((status = 'stopped') = (stopped_reason IS NOT NULL)),
    CONSTRAINT notification_delivery_pending_shape CHECK (
        status <> 'pending'
        OR (failure_code IS NULL AND correlation_id IS NULL AND stopped_reason IS NULL))
);

CREATE INDEX notification_delivery_pending_due
    ON vc.notification_delivery (owner_user_id, next_attempt_at)
    WHERE status = 'pending';

ALTER TABLE vc.inbox_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.inbox_event FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.notification_channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.notification_channel FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.notification_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.notification_delivery FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON vc.inbox_event FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.notification_channel FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.notification_delivery FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.inbox_event, vc.notification_channel, vc.notification_delivery FROM PUBLIC;
GRANT SELECT ON vc.inbox_event, vc.notification_channel, vc.notification_delivery TO vc_api, vc_worker;
REVOKE ALL ON SEQUENCE vc.inbox_event_id_seq, vc.notification_channel_id_seq,
    vc.notification_delivery_id_seq FROM PUBLIC;
GRANT USAGE, SELECT ON SEQUENCE vc.inbox_event_id_seq, vc.notification_channel_id_seq,
    vc.notification_delivery_id_seq TO vc_api, vc_worker;

CREATE TRIGGER inbox_event_deletion_intent_guard
    BEFORE INSERT ON vc.inbox_event
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();
CREATE TRIGGER notification_delivery_deletion_intent_guard
    BEFORE INSERT ON vc.notification_delivery
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE FUNCTION vc.put_notification_channel(
    p_owner bigint,
    p_channel text,
    p_enabled boolean,
    p_configured_target text,
    p_credential_cipher text,
    p_preview_body boolean,
    p_relationship_ids bigint[])
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_target text;
    v_cred text;
    v_rels bigint[];
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_channel IS NULL OR p_channel NOT IN ('EMAIL', 'FEISHU')
       OR p_enabled IS NULL OR p_preview_body IS NULL THEN
        RAISE EXCEPTION 'notification channel: target is invalid';
    END IF;
    v_target := NULLIF(btrim(p_configured_target), '');
    IF v_target IS NULL OR char_length(v_target) > 320 THEN
        RAISE EXCEPTION 'notification channel: target is invalid';
    END IF;
    IF v_target ~* 'https?://' THEN
        RAISE EXCEPTION 'notification channel: target must not carry a URL';
    END IF;
    v_cred := NULLIF(btrim(p_credential_cipher), '');
    IF v_cred IS NOT NULL AND v_cred !~ '^enc2:[^:]+:[1-9][0-9]*:.+$' THEN
        RAISE EXCEPTION 'notification channel: credential must be field ciphertext';
    END IF;
    v_rels := COALESCE(p_relationship_ids, '{}'::bigint[]);
    IF cardinality(v_rels) > 32
       OR EXISTS (
            SELECT 1 FROM unnest(v_rels) AS rel(id)
            GROUP BY id
            HAVING count(*) > 1 OR id IS NULL OR id <= 0)
       OR (
            SELECT count(*) FROM vc.relationship r
            WHERE r.owner_user_id = p_owner AND r.id = ANY (v_rels)
       ) IS DISTINCT FROM cardinality(v_rels) THEN
        RAISE EXCEPTION 'notification channel: relationship not found';
    END IF;
    INSERT INTO vc.notification_channel(
        owner_user_id, id, channel, enabled, configured_target,
        credential_cipher, preview_body, relationship_ids)
    VALUES (
        p_owner, nextval('vc.notification_channel_id_seq'), p_channel, p_enabled, v_target,
        v_cred, p_preview_body, v_rels)
    ON CONFLICT (owner_user_id, channel, configured_target) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            credential_cipher = EXCLUDED.credential_cipher,
            preview_body = EXCLUDED.preview_body,
            relationship_ids = EXCLUDED.relationship_ids,
            updated_at = clock_timestamp()
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.create_inbox_event(
    p_owner bigint,
    p_event_id text,
    p_conversation_id bigint,
    p_branch text,
    p_source_revision bigint,
    p_expires_at timestamptz)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_relationship bigint;
    v_status text;
    v_greeting text;
    v_intent text;
    v_body text;
    v_branch text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    SELECT f.relationship_id, f.status, f.greeting_body
      INTO v_relationship, v_status, v_greeting
      FROM vc.follow_up f
     WHERE f.owner_user_id = p_owner AND f.event_id = p_event_id
     FOR SHARE;
    IF NOT FOUND OR v_status NOT IN ('BODY_READY', 'WAITING_HOST') THEN
        RAISE EXCEPTION 'inbox event: follow-up is not ready';
    END IF;
    IF v_status = 'BODY_READY' THEN
        IF v_greeting IS NULL OR btrim(v_greeting) = '' THEN
            RAISE EXCEPTION 'inbox event: follow-up is not ready';
        END IF;
        v_intent := 'BODY';
        v_body := v_greeting;
    ELSE
        v_intent := 'WAITING_HOST';
        v_body := NULL;
    END IF;
    v_branch := NULLIF(btrim(p_branch), '');
    IF p_conversation_id IS NULL OR p_conversation_id <= 0
       OR (v_branch IS NOT NULL AND char_length(v_branch) > 128)
       OR (p_source_revision IS NOT NULL AND p_source_revision < 0) THEN
        RAISE EXCEPTION 'inbox event: conversation not found';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.conversation c
        WHERE c.owner_user_id = p_owner
          AND c.id = p_conversation_id
          AND c.relationship_id = v_relationship
    ) THEN
        RAISE EXCEPTION 'inbox event: conversation not found';
    END IF;
    v_id := nextval('vc.inbox_event_id_seq');
    BEGIN
        INSERT INTO vc.inbox_event(
            owner_user_id, id, event_id, relationship_id, conversation_id,
            branch, source_revision, intent, body, expires_at)
        VALUES (
            p_owner, v_id, p_event_id, v_relationship, p_conversation_id,
            v_branch, p_source_revision, v_intent, v_body, p_expires_at);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'inbox event already exists';
    END;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.create_notification_delivery(
    p_owner bigint,
    p_event_id text,
    p_channel text,
    p_configured_target text)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_relationship bigint;
    v_expires timestamptz;
    v_status text;
    v_target text;
    v_granted boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    v_target := NULLIF(btrim(p_configured_target), '');
    SELECT i.relationship_id, i.expires_at
      INTO v_relationship, v_expires
      FROM vc.inbox_event i
     WHERE i.owner_user_id = p_owner AND i.event_id = p_event_id
     FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
    SELECT f.status INTO v_status
      FROM vc.follow_up f
     WHERE f.owner_user_id = p_owner AND f.event_id = p_event_id;
    IF v_status = 'CANCELLED' THEN
        RAISE EXCEPTION 'notification delivery: follow-up is cancelled';
    END IF;
    IF v_expires IS NOT NULL AND v_expires <= clock_timestamp() THEN
        RAISE EXCEPTION 'notification delivery: inbox event expired';
    END IF;
    IF p_channel NOT IN ('EMAIL', 'FEISHU') OR v_target IS NULL OR NOT EXISTS (
        SELECT 1 FROM vc.notification_channel c
        WHERE c.owner_user_id = p_owner
          AND c.channel = p_channel
          AND c.configured_target = v_target
          AND c.enabled
          AND v_relationship = ANY (c.relationship_ids)
    ) THEN
        RAISE EXCEPTION 'notification delivery: channel is not enabled for this character';
    END IF;
    SELECT c.granted INTO v_granted
      FROM vc.consent_record c
     WHERE c.owner_user_id = p_owner AND c.consent_type = 'PUSH_NOTIFICATION'
     ORDER BY c.id DESC
     LIMIT 1;
    IF v_granted IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'notification delivery: PUSH_NOTIFICATION consent is not current';
    END IF;
    v_id := nextval('vc.notification_delivery_id_seq');
    BEGIN
        INSERT INTO vc.notification_delivery(
            owner_user_id, id, event_id, channel, configured_target)
        VALUES (p_owner, v_id, p_event_id, p_channel, v_target);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'notification delivery: duplicate target';
    END;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.record_notification_delivery_outcome(
    p_owner bigint,
    p_delivery_id bigint,
    p_outcome text,
    p_failure_code text,
    p_correlation text)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_outcome text := NULLIF(btrim(p_outcome), '');
    v_failure text := NULLIF(btrim(p_failure_code), '');
    v_corr text := NULLIF(btrim(p_correlation), '');
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF v_outcome IS NULL OR v_outcome NOT IN ('accepted', 'failed', 'unknown') THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    SELECT d.status INTO v_status
      FROM vc.notification_delivery d
     WHERE d.owner_user_id = p_owner AND d.id = p_delivery_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    IF v_status = v_outcome THEN
        RETURN v_status;
    END IF;
    IF (v_status = 'unknown' AND v_outcome = 'failed')
       OR (v_status = 'failed' AND v_outcome = 'unknown') THEN
        RAISE EXCEPTION 'notification delivery: unknown and failed cannot be mixed';
    END IF;
    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    IF v_outcome = 'unknown' AND v_failure IS NOT NULL THEN
        RAISE EXCEPTION 'notification delivery: unknown and failed cannot be mixed';
    END IF;
    IF v_outcome = 'failed' AND (v_failure IS NULL OR v_failure !~ '^[A-Z0-9_]{1,64}$') THEN
        RAISE EXCEPTION 'notification delivery: failed requires a failure code';
    END IF;
    IF v_outcome = 'accepted' AND (v_corr IS NULL OR v_corr !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN
        RAISE EXCEPTION 'notification delivery: accepted requires a correlation id';
    END IF;
    IF v_outcome = 'accepted' AND v_failure IS NOT NULL THEN
        RAISE EXCEPTION 'notification delivery: accepted cannot be failed';
    END IF;
    IF v_outcome <> 'failed' THEN
        v_failure := NULL;
    END IF;
    IF v_corr IS NOT NULL AND v_corr !~ '^[A-Za-z0-9_.:-]{1,128}$' THEN
        v_corr := NULL;
    END IF;
    UPDATE vc.notification_delivery
       SET status = v_outcome,
           failure_code = v_failure,
           correlation_id = v_corr,
           attempt_count = attempt_count + 1,
           next_attempt_at = NULL,
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner AND id = p_delivery_id;
    RETURN v_outcome;
END;
$$;

CREATE FUNCTION vc.claim_inbox_event(
    p_owner bigint,
    p_event_id text,
    p_lease_seconds integer)
    RETURNS TABLE(out_token text, out_expires_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_token text;
    v_expires timestamptz;
    v_old_expires timestamptz;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_lease_seconds IS NULL OR p_lease_seconds < 1 OR p_lease_seconds > 120 THEN
        RAISE EXCEPTION 'inbox lease seconds are invalid';
    END IF;
    SELECT i.lease_expires_at INTO v_old_expires
      FROM vc.inbox_event i
     WHERE i.owner_user_id = p_owner AND i.event_id = p_event_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
    IF v_old_expires IS NOT NULL AND v_old_expires > clock_timestamp() THEN
        RAISE EXCEPTION 'inbox lease is held';
    END IF;
    v_token := gen_random_uuid()::text;
    v_expires := clock_timestamp() + (p_lease_seconds * interval '1 second');
    UPDATE vc.inbox_event
       SET lease_token = v_token,
           lease_expires_at = v_expires
     WHERE owner_user_id = p_owner AND event_id = p_event_id;
    RETURN QUERY SELECT v_token, v_expires;
END;
$$;

CREATE FUNCTION vc.ack_inbox_event(
    p_owner bigint,
    p_event_id text,
    p_lease_token text,
    p_message_id text,
    p_message_revision bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_token text;
    v_expires timestamptz;
    v_message text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT i.lease_token, i.lease_expires_at
      INTO v_token, v_expires
      FROM vc.inbox_event i
     WHERE i.owner_user_id = p_owner AND i.event_id = p_event_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
    IF v_token IS NULL OR v_expires IS NULL OR v_expires <= clock_timestamp() THEN
        RAISE EXCEPTION 'inbox lease expired';
    END IF;
    IF v_token IS DISTINCT FROM p_lease_token THEN
        RAISE EXCEPTION 'inbox lease token does not match';
    END IF;
    v_message := NULLIF(btrim(p_message_id), '');
    IF v_message IS NULL OR char_length(v_message) > 128
       OR p_message_revision IS NULL OR p_message_revision < 0 THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
    UPDATE vc.inbox_event
       SET st_delivered = true,
           st_message_id = v_message,
           st_message_revision = p_message_revision,
           lease_token = NULL,
           lease_expires_at = NULL
     WHERE owner_user_id = p_owner AND event_id = p_event_id;
    RETURN true;
END;
$$;

CREATE FUNCTION vc.stop_unsent_notification_deliveries(
    p_owner bigint,
    p_event_id text,
    p_reason text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_reason IS NULL OR p_reason NOT IN ('cancelled', 'expired', 'consent_withdrawn') THEN
        RAISE EXCEPTION 'notification delivery: stop reason is invalid';
    END IF;
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.notification_delivery
       SET status = 'stopped',
           stopped_reason = p_reason,
           next_attempt_at = NULL,
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner
       AND status = 'pending'
       AND (p_event_id IS NULL OR event_id = p_event_id);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE FUNCTION vc.expire_inbox_event(p_owner bigint, p_event_id text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (
        SELECT 1 FROM vc.inbox_event i
        WHERE i.owner_user_id = p_owner AND i.event_id = p_event_id
    ) THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
    UPDATE vc.inbox_event
       SET expires_at = clock_timestamp()
     WHERE owner_user_id = p_owner
       AND event_id = p_event_id
       AND (expires_at IS NULL OR expires_at > clock_timestamp());
    RETURN vc.stop_unsent_notification_deliveries(p_owner, p_event_id, 'expired');
END;
$$;

CREATE FUNCTION vc.set_inbox_link_status(p_owner bigint, p_event_id text, p_status text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_status IS NULL OR p_status NOT IN ('present', 'removed', 'invalidated') THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
    UPDATE vc.inbox_event
       SET link_status = p_status
     WHERE owner_user_id = p_owner AND event_id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
END;
$$;

CREATE FUNCTION vc.mark_inbox_read(p_owner bigint, p_event_id text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.inbox_event
       SET read_at = COALESCE(read_at, clock_timestamp())
     WHERE owner_user_id = p_owner AND event_id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'inbox event not found';
    END IF;
END;
$$;

CREATE FUNCTION vc.stop_inbox_deliveries_on_follow_up_cancel()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NEW.status = 'CANCELLED' AND OLD.status IS DISTINCT FROM 'CANCELLED' THEN
        PERFORM vc.stop_unsent_notification_deliveries(NEW.owner_user_id, NEW.event_id, 'cancelled');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER follow_up_cancel_stops_notification
    AFTER UPDATE OF status ON vc.follow_up
    FOR EACH ROW EXECUTE FUNCTION vc.stop_inbox_deliveries_on_follow_up_cancel();

CREATE FUNCTION vc.stop_notification_on_push_withdrawal()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NEW.consent_type = 'PUSH_NOTIFICATION' AND NEW.granted = false THEN
        PERFORM vc.stop_unsent_notification_deliveries(NEW.owner_user_id, NULL, 'consent_withdrawn');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER consent_push_withdrawal_stops_notification
    AFTER INSERT ON vc.consent_record
    FOR EACH ROW EXECUTE FUNCTION vc.stop_notification_on_push_withdrawal();

-- schedule keeps a retry pending. record_notification_delivery_outcome treats
-- unknown and failed as terminal, so a bounded retry must not call it yet.
-- list_due is a cross-owner scan and returns no body and no credential.
-- load is owner-scoped and also returns no credential.
CREATE FUNCTION vc.schedule_notification_delivery(
    p_owner bigint,
    p_delivery_id bigint,
    p_attempt_count integer,
    p_next_attempt_at timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_attempts integer;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_attempt_count IS NULL OR p_attempt_count < 0 OR p_next_attempt_at IS NULL THEN
        RAISE EXCEPTION 'notification delivery: schedule is invalid';
    END IF;
    SELECT d.status, d.attempt_count INTO v_status, v_attempts
      FROM vc.notification_delivery d
     WHERE d.owner_user_id = p_owner AND d.id = p_delivery_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification delivery not found';
    END IF;
    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    IF p_attempt_count < v_attempts THEN
        RAISE EXCEPTION 'notification delivery: schedule is invalid';
    END IF;
    UPDATE vc.notification_delivery
       SET attempt_count = p_attempt_count,
           next_attempt_at = p_next_attempt_at,
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner AND id = p_delivery_id;
END;
$$;

CREATE FUNCTION vc.list_due_notification_deliveries(p_now timestamptz)
    RETURNS TABLE(out_owner bigint, out_id bigint)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT d.owner_user_id, d.id
      FROM vc.notification_delivery d
      JOIN vc.inbox_event i
        ON (i.owner_user_id, i.event_id) = (d.owner_user_id, d.event_id)
      JOIN vc.notification_channel c
        ON c.owner_user_id = d.owner_user_id
       AND c.channel = d.channel
       AND c.configured_target = d.configured_target
       AND c.enabled
       AND i.relationship_id = ANY (c.relationship_ids)
     WHERE d.status = 'pending'
       AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= COALESCE(p_now, clock_timestamp()))
       AND NOT EXISTS (
            SELECT 1 FROM vc.account_deletion_intent a
             WHERE a.account_id = d.owner_user_id)
     ORDER BY d.next_attempt_at NULLS FIRST, d.owner_user_id, d.id;
$$;

CREATE FUNCTION vc.load_notification_delivery(
    p_owner bigint,
    p_delivery_id bigint,
    p_now timestamptz)
    RETURNS TABLE(
        out_id bigint,
        out_event_id text,
        out_channel text,
        out_configured_target text,
        out_status text,
        out_attempt_count integer,
        out_next_attempt_at timestamptz,
        out_intent text,
        out_body text,
        out_preview boolean,
        out_relationship bigint,
        out_channel_enabled boolean,
        out_policy_enabled boolean,
        out_quiet_start text,
        out_quiet_end text,
        out_quiet_timezone text,
        out_daily_limit integer,
        out_consent boolean,
        out_deletion boolean,
        out_sent_today integer,
        out_trigger_at timestamptz,
        out_follow_status text,
        out_st_delivered boolean,
        out_expires_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_now timestamptz := COALESCE(p_now, clock_timestamp());
    v_zone text;
    v_day timestamptz;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT d.id, d.event_id, d.channel, d.configured_target, d.status,
           d.attempt_count, d.next_attempt_at
      INTO out_id, out_event_id, out_channel, out_configured_target, out_status,
           out_attempt_count, out_next_attempt_at
      FROM vc.notification_delivery d
     WHERE d.owner_user_id = p_owner AND d.id = p_delivery_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification delivery not found';
    END IF;
    SELECT i.relationship_id, i.intent, i.body, i.st_delivered, i.expires_at
      INTO out_relationship, out_intent, out_body, out_st_delivered, out_expires_at
      FROM vc.inbox_event i
     WHERE i.owner_user_id = p_owner AND i.event_id = out_event_id;
    SELECT f.status, f.trigger_at
      INTO out_follow_status, out_trigger_at
      FROM vc.follow_up f
     WHERE f.owner_user_id = p_owner AND f.event_id = out_event_id;
    SELECT (c.enabled AND out_relationship = ANY (c.relationship_ids)), c.preview_body
      INTO out_channel_enabled, out_preview
      FROM vc.notification_channel c
     WHERE c.owner_user_id = p_owner
       AND c.channel = out_channel
       AND c.configured_target = out_configured_target;
    out_channel_enabled := COALESCE(out_channel_enabled, false);
    out_preview := COALESCE(out_preview, false);
    SELECT COALESCE(p.enabled, false),
           to_char(p.quiet_hours_start, 'HH24:MI'),
           to_char(p.quiet_hours_end, 'HH24:MI'),
           p.quiet_hours_timezone,
           COALESCE(p.daily_limit, 0)
      INTO out_policy_enabled, out_quiet_start, out_quiet_end, out_quiet_timezone, out_daily_limit
      FROM vc.proactive_policy p
     WHERE p.owner_user_id = p_owner AND p.relationship_id = out_relationship;
    out_policy_enabled := COALESCE(out_policy_enabled, false);
    out_daily_limit := COALESCE(out_daily_limit, 0);
    IF out_quiet_timezone IS NOT NULL THEN
        out_quiet_timezone := vc.follow_up_zone(out_quiet_timezone);
    END IF;
    SELECT c.granted INTO out_consent
      FROM vc.consent_record c
     WHERE c.owner_user_id = p_owner AND c.consent_type = 'PUSH_NOTIFICATION'
     ORDER BY c.id DESC
     LIMIT 1;
    out_consent := COALESCE(out_consent, false);
    out_deletion := EXISTS (
        SELECT 1 FROM vc.account_deletion_intent a WHERE a.account_id = p_owner);
    v_zone := vc.follow_up_zone(out_quiet_timezone);
    v_day := (date_trunc('day', v_now AT TIME ZONE v_zone) AT TIME ZONE v_zone);
    SELECT count(DISTINCT d2.event_id)::integer INTO out_sent_today
      FROM vc.notification_delivery d2
      JOIN vc.inbox_event i2
        ON (i2.owner_user_id, i2.event_id) = (d2.owner_user_id, d2.event_id)
     WHERE d2.owner_user_id = p_owner
       AND i2.relationship_id = out_relationship
       AND d2.status IN ('accepted', 'unknown')
       AND d2.updated_at >= v_day
       AND d2.updated_at < v_day + interval '1 day';
    out_sent_today := COALESCE(out_sent_today, 0);
    RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION vc.put_notification_channel(bigint, text, boolean, text, text, boolean, bigint[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.create_inbox_event(bigint, text, bigint, text, bigint, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.create_notification_delivery(bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.record_notification_delivery_outcome(bigint, bigint, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.claim_inbox_event(bigint, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.ack_inbox_event(bigint, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.expire_inbox_event(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.set_inbox_link_status(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.mark_inbox_read(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.stop_unsent_notification_deliveries(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.stop_inbox_deliveries_on_follow_up_cancel() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.stop_notification_on_push_withdrawal() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.schedule_notification_delivery(bigint, bigint, integer, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.list_due_notification_deliveries(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.load_notification_delivery(bigint, bigint, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.put_notification_channel(bigint, text, boolean, text, text, boolean, bigint[]),
    vc.create_inbox_event(bigint, text, bigint, text, bigint, timestamptz),
    vc.create_notification_delivery(bigint, text, text, text),
    vc.record_notification_delivery_outcome(bigint, bigint, text, text, text),
    vc.claim_inbox_event(bigint, text, integer),
    vc.ack_inbox_event(bigint, text, text, text, bigint),
    vc.expire_inbox_event(bigint, text),
    vc.set_inbox_link_status(bigint, text, text),
    vc.mark_inbox_read(bigint, text)
    TO vc_api, vc_worker;

GRANT EXECUTE ON FUNCTION
    vc.stop_unsent_notification_deliveries(bigint, text, text),
    vc.schedule_notification_delivery(bigint, bigint, integer, timestamptz),
    vc.list_due_notification_deliveries(timestamptz),
    vc.load_notification_delivery(bigint, bigint, timestamptz)
    TO vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint) RENAME TO export_v2_owner_metadata_v180_base;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_v180_base(p_owner) || jsonb_build_object(
        'inbox', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'inboxId', e.id::text,
                'eventId', e.event_id,
                'relationshipId', e.relationship_id::text,
                'conversationId', e.conversation_id::text,
                'branch', e.branch,
                'sourceRevision', e.source_revision,
                'intent', e.intent,
                'body', e.body,
                'persisted', true,
                'stDelivered', e.st_delivered,
                'messageId', e.st_message_id,
                'messageRevision', e.st_message_revision,
                'linkStatus', e.link_status,
                'readAt', e.read_at,
                'read', e.read_at IS NOT NULL
            ) ORDER BY e.id)
            FROM vc.inbox_event e
            WHERE e.owner_user_id = p_owner
        ), '[]'::jsonb),
        'notificationChannels', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'channelId', c.id::text,
                'channel', c.channel,
                'enabled', c.enabled,
                'configuredTarget', c.configured_target,
                'previewBody', c.preview_body,
                'relationshipIds', to_jsonb(c.relationship_ids)
            ) ORDER BY c.id)
            FROM vc.notification_channel c
            WHERE c.owner_user_id = p_owner
        ), '[]'::jsonb),
        'notificationDeliveries', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'deliveryId', d.id::text,
                'eventId', d.event_id,
                'channel', d.channel,
                'configuredTarget', d.configured_target,
                'status', d.status,
                'attemptCount', d.attempt_count,
                'nextAttemptAt', d.next_attempt_at,
                'correlationId', d.correlation_id,
                'failureCode', d.failure_code,
                'stoppedReason', d.stopped_reason
            ) ORDER BY d.id)
            FROM vc.notification_delivery d
            WHERE d.owner_user_id = p_owner
        ), '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint), vc.export_v2_owner_metadata_v180_base(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_v180_base(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
