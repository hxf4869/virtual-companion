-- Companion daily mood, decaying affect, and the proactive engine.
-- Old migrations stay as they were. A missing policy row remains OFF.
-- create_relationship writes the new-relationship default. A 10-argument
-- put keeps working: enabled false becomes OFF, enabled true becomes
-- FOLLOW_UP unless the row is already DAILY or CLOSE_FRIEND.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.proactive_policy
    ADD COLUMN mode text NOT NULL DEFAULT 'OFF',
    ADD COLUMN check_in_after_minutes integer NOT NULL DEFAULT 720;

UPDATE vc.proactive_policy
   SET mode = CASE WHEN enabled THEN 'FOLLOW_UP' ELSE 'OFF' END,
       check_in_after_minutes = 720;

ALTER TABLE vc.proactive_policy
    ADD CONSTRAINT proactive_policy_mode CHECK (mode IN ('OFF', 'FOLLOW_UP', 'DAILY', 'CLOSE_FRIEND')),
    ADD CONSTRAINT proactive_policy_check_in CHECK (check_in_after_minutes BETWEEN 120 AND 4320);

CREATE TABLE vc.companion_affect (
    owner_user_id bigint NOT NULL,
    relationship_id bigint NOT NULL,
    closeness integer NOT NULL DEFAULT 50,
    mood integer NOT NULL DEFAULT 50,
    energy integer NOT NULL DEFAULT 50,
    close_base integer NOT NULL DEFAULT 50,
    mood_base integer NOT NULL DEFAULT 50,
    energy_base integer NOT NULL DEFAULT 50,
    updated_at timestamptz,
    last_source_ref text,
    busy_until timestamptz,
    unanswered integer NOT NULL DEFAULT 0,
    last_user_message_at timestamptz,
    last_proactive_at timestamptz,
    last_judgment_at timestamptz,
    PRIMARY KEY (owner_user_id, relationship_id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT companion_affect_range CHECK (
        closeness BETWEEN 0 AND 100 AND mood BETWEEN 0 AND 100 AND energy BETWEEN 0 AND 100
        AND close_base BETWEEN 0 AND 100 AND mood_base BETWEEN 0 AND 100 AND energy_base BETWEEN 0 AND 100
        AND unanswered BETWEEN 0 AND 100)
);

CREATE TABLE vc.companion_daily_mood (
    owner_user_id bigint NOT NULL,
    relationship_id bigint NOT NULL,
    local_date date NOT NULL,
    tier text NOT NULL,
    vibe text NOT NULL,
    line text NOT NULL,
    redrawn boolean NOT NULL DEFAULT false,
    PRIMARY KEY (owner_user_id, relationship_id, local_date),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT companion_daily_mood_tier CHECK (tier IN ('WANT_TO_CHAT', 'JUST_CHILL', 'LEAVE_ME')),
    CONSTRAINT companion_daily_mood_vibe CHECK (char_length(vibe) BETWEEN 1 AND 16),
    CONSTRAINT companion_daily_mood_line CHECK (char_length(line) BETWEEN 1 AND 80)
);

CREATE SEQUENCE vc.proactive_message_id_seq AS bigint;

CREATE TABLE vc.proactive_message (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.proactive_message_id_seq'),
    relationship_id bigint NOT NULL,
    trigger_key text NOT NULL,
    kind text NOT NULL,
    cluster_key text NOT NULL,
    reminder boolean NOT NULL DEFAULT false,
    status text NOT NULL,
    body text,
    topic text,
    planned_at timestamptz,
    armed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    delivered_at timestamptz,
    follow_up_id bigint,
    event_id text,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT proactive_message_status CHECK (status IN ('READY', 'INBOX', 'CANCELLED', 'EXPIRED', 'SILENT')),
    CONSTRAINT proactive_message_kind CHECK (kind IN ('check_in', 'continue_topic', 'share', 'care')),
    CONSTRAINT proactive_message_body CHECK (
        (status IN ('READY', 'INBOX') AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 4000)
        OR status NOT IN ('READY', 'INBOX'))
);

CREATE INDEX proactive_message_ready
    ON vc.proactive_message (owner_user_id, relationship_id, planned_at)
    WHERE status = 'READY';

CREATE TABLE vc.proactive_cooldown (
    owner_user_id bigint NOT NULL,
    relationship_id bigint NOT NULL,
    cooldown_key text NOT NULL,
    until_at timestamptz NOT NULL,
    PRIMARY KEY (owner_user_id, relationship_id, cooldown_key),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT proactive_cooldown_key CHECK (cooldown_key ~ '^[a-z:_]{1,64}$')
);

ALTER TABLE vc.companion_affect ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.companion_affect FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.companion_daily_mood ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.companion_daily_mood FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.proactive_message ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.proactive_message FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.proactive_cooldown ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.proactive_cooldown FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON vc.companion_affect FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.companion_daily_mood FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.proactive_message FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.proactive_cooldown FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.companion_affect, vc.companion_daily_mood, vc.proactive_message, vc.proactive_cooldown, vc.proactive_message_id_seq FROM PUBLIC;
GRANT SELECT ON vc.companion_affect, vc.companion_daily_mood, vc.proactive_message, vc.proactive_cooldown TO vc_api, vc_worker;
GRANT USAGE, SELECT ON SEQUENCE vc.proactive_message_id_seq TO vc_api, vc_worker;

DROP FUNCTION vc.put_proactive_policy(bigint, bigint, boolean, text, text, text, integer, integer, text[], boolean);
DROP FUNCTION vc.get_proactive_policy(bigint, bigint);

CREATE FUNCTION vc.put_proactive_policy(
    p_owner bigint,
    p_relationship bigint,
    p_enabled boolean,
    p_quiet_start text,
    p_quiet_end text,
    p_quiet_timezone text,
    p_daily_limit integer,
    p_recent_interaction_minutes integer,
    p_allowed_modes text[],
    p_offline_capable boolean,
    p_mode text DEFAULT NULL,
    p_check_in integer DEFAULT NULL)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_start time;
    v_end time;
    v_zone text;
    v_mode text;
    v_check integer;
    v_enabled boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_enabled IS NULL OR p_offline_capable IS NULL THEN
        RAISE EXCEPTION 'proactive_policy: enabled and offline capability are required';
    END IF;
    IF p_daily_limit IS NULL OR p_daily_limit < 0 OR p_daily_limit > 48
       OR p_recent_interaction_minutes IS NULL OR p_recent_interaction_minutes < 0
       OR p_recent_interaction_minutes > 10080 THEN
        RAISE EXCEPTION 'proactive_policy: limit out of range';
    END IF;
    IF p_allowed_modes IS NULL OR cardinality(p_allowed_modes) NOT BETWEEN 1 AND 2
       OR NOT p_allowed_modes <@ ARRAY['COMPANION', 'STORY']::text[] THEN
        RAISE EXCEPTION 'proactive_policy: allowed modes must be COMPANION and/or STORY';
    END IF;
    v_zone := NULLIF(btrim(p_quiet_timezone), '');
    v_start := CASE WHEN p_quiet_start IS NULL OR btrim(p_quiet_start) = '' THEN NULL ELSE p_quiet_start::time END;
    v_end := CASE WHEN p_quiet_end IS NULL OR btrim(p_quiet_end) = '' THEN NULL ELSE p_quiet_end::time END;
    IF (v_start IS NULL AND v_end IS NULL AND v_zone IS NULL)
       OR (v_start IS NOT NULL AND v_end IS NOT NULL AND v_zone IS NOT NULL) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'proactive_policy: quiet hours require start, end and timezone';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.relationship
         WHERE owner_user_id = p_owner AND id = p_relationship) THEN
        RAISE EXCEPTION 'proactive_policy: relationship not found';
    END IF;
    v_mode := NULLIF(btrim(COALESCE(p_mode, '')), '');
    IF v_mode IS NULL THEN
        IF p_enabled IS NOT TRUE THEN
            v_mode := 'OFF';
        ELSE
            SELECT p.mode INTO v_mode
              FROM vc.proactive_policy p
             WHERE p.owner_user_id = p_owner AND p.relationship_id = p_relationship;
            IF v_mode IS NULL OR v_mode NOT IN ('DAILY', 'CLOSE_FRIEND', 'FOLLOW_UP') THEN
                v_mode := 'FOLLOW_UP';
            END IF;
        END IF;
    ELSIF v_mode NOT IN ('OFF', 'FOLLOW_UP', 'DAILY', 'CLOSE_FRIEND') THEN
        RAISE EXCEPTION 'proactive_policy: mode is not allowed';
    END IF;
    v_enabled := v_mode <> 'OFF';
    v_check := p_check_in;
    IF v_check IS NULL THEN
        SELECT p.check_in_after_minutes INTO v_check
          FROM vc.proactive_policy p
         WHERE p.owner_user_id = p_owner AND p.relationship_id = p_relationship;
        IF v_check IS NULL THEN
            v_check := 720;
        END IF;
    END IF;
    IF v_check < 120 OR v_check > 4320 THEN
        RAISE EXCEPTION 'proactive_policy: check-in out of range';
    END IF;
    INSERT INTO vc.proactive_policy(
        owner_user_id, relationship_id, enabled, quiet_hours_start, quiet_hours_end,
        quiet_hours_timezone, daily_limit, recent_interaction_minutes, allowed_modes,
        offline_capable, mode, check_in_after_minutes)
    VALUES (
        p_owner, p_relationship, v_enabled, v_start, v_end, v_zone, p_daily_limit,
        p_recent_interaction_minutes, p_allowed_modes, p_offline_capable, v_mode, v_check)
    ON CONFLICT (owner_user_id, relationship_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            quiet_hours_start = EXCLUDED.quiet_hours_start,
            quiet_hours_end = EXCLUDED.quiet_hours_end,
            quiet_hours_timezone = EXCLUDED.quiet_hours_timezone,
            daily_limit = EXCLUDED.daily_limit,
            recent_interaction_minutes = EXCLUDED.recent_interaction_minutes,
            allowed_modes = EXCLUDED.allowed_modes,
            offline_capable = EXCLUDED.offline_capable,
            mode = EXCLUDED.mode,
            check_in_after_minutes = EXCLUDED.check_in_after_minutes,
            updated_at = clock_timestamp();
END;
$$;

CREATE FUNCTION vc.get_proactive_policy(p_owner bigint, p_relationship bigint)
    RETURNS TABLE(
        out_enabled boolean,
        out_quiet_start time,
        out_quiet_end time,
        out_quiet_timezone text,
        out_daily_limit integer,
        out_recent_interaction_minutes integer,
        out_allowed_modes text[],
        out_offline_capable boolean,
        out_mode text,
        out_check_in_after_minutes integer)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
    SELECT COALESCE(p.enabled, false),
           p.quiet_hours_start,
           p.quiet_hours_end,
           p.quiet_hours_timezone,
           COALESCE(p.daily_limit, 0),
           COALESCE(p.recent_interaction_minutes, 0),
           COALESCE(p.allowed_modes, ARRAY['COMPANION']::text[]),
           COALESCE(p.offline_capable, false),
           COALESCE(p.mode, 'OFF'),
           COALESCE(p.check_in_after_minutes, 720)
      FROM vc.relationship r
      LEFT JOIN vc.proactive_policy p
        ON (p.owner_user_id, p.relationship_id) = (r.owner_user_id, r.id)
     WHERE r.owner_user_id = p_owner AND r.id = p_relationship;
END;
$$;

CREATE FUNCTION vc.save_companion_affect(
    p_owner bigint,
    p_relationship bigint,
    p_closeness integer,
    p_mood integer,
    p_energy integer,
    p_close_base integer,
    p_mood_base integer,
    p_energy_base integer,
    p_updated_at timestamptz,
    p_source_ref text,
    p_busy_until timestamptz,
    p_unanswered integer,
    p_last_user timestamptz,
    p_last_proactive timestamptz,
    p_last_judgment timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (
        SELECT 1 FROM vc.relationship
         WHERE owner_user_id = p_owner AND id = p_relationship) THEN
        RAISE EXCEPTION 'proactive: relationship not found';
    END IF;
    INSERT INTO vc.companion_affect(
        owner_user_id, relationship_id, closeness, mood, energy,
        close_base, mood_base, energy_base, updated_at, last_source_ref,
        busy_until, unanswered, last_user_message_at, last_proactive_at, last_judgment_at)
    VALUES (
        p_owner, p_relationship, p_closeness, p_mood, p_energy,
        p_close_base, p_mood_base, p_energy_base, p_updated_at, NULLIF(btrim(p_source_ref), ''),
        p_busy_until, p_unanswered, p_last_user, p_last_proactive, p_last_judgment)
    ON CONFLICT (owner_user_id, relationship_id) DO UPDATE
        SET closeness = EXCLUDED.closeness,
            mood = EXCLUDED.mood,
            energy = EXCLUDED.energy,
            close_base = EXCLUDED.close_base,
            mood_base = EXCLUDED.mood_base,
            energy_base = EXCLUDED.energy_base,
            updated_at = EXCLUDED.updated_at,
            last_source_ref = EXCLUDED.last_source_ref,
            busy_until = EXCLUDED.busy_until,
            unanswered = EXCLUDED.unanswered,
            last_user_message_at = EXCLUDED.last_user_message_at,
            last_proactive_at = EXCLUDED.last_proactive_at,
            last_judgment_at = EXCLUDED.last_judgment_at;
END;
$$;

CREATE FUNCTION vc.save_companion_mood(
    p_owner bigint,
    p_relationship bigint,
    p_local_date date,
    p_tier text,
    p_vibe text,
    p_line text,
    p_redrawn boolean)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    INSERT INTO vc.companion_daily_mood(
        owner_user_id, relationship_id, local_date, tier, vibe, line, redrawn)
    VALUES (p_owner, p_relationship, p_local_date, p_tier, p_vibe, p_line, COALESCE(p_redrawn, false))
    ON CONFLICT (owner_user_id, relationship_id, local_date) DO UPDATE
        SET tier = EXCLUDED.tier,
            vibe = EXCLUDED.vibe,
            line = EXCLUDED.line,
            redrawn = true
      WHERE vc.companion_daily_mood.redrawn = false
        AND EXCLUDED.redrawn = true;
END;
$$;

CREATE FUNCTION vc.insert_proactive_message(
    p_owner bigint,
    p_relationship bigint,
    p_trigger text,
    p_kind text,
    p_cluster text,
    p_reminder boolean,
    p_body text,
    p_topic text,
    p_planned timestamptz,
    p_armed timestamptz)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_body IS NULL OR btrim(p_body) = '' OR char_length(p_body) > 4000 OR p_planned IS NULL THEN
        RAISE EXCEPTION 'proactive: message is invalid';
    END IF;
    v_id := nextval('vc.proactive_message_id_seq');
    INSERT INTO vc.proactive_message(
        owner_user_id, id, relationship_id, trigger_key, kind, cluster_key, reminder,
        status, body, topic, planned_at, armed_at)
    VALUES (
        p_owner, v_id, p_relationship, p_trigger, p_kind, p_cluster, COALESCE(p_reminder, false),
        'READY', btrim(p_body), NULLIF(btrim(p_topic), ''), p_planned, p_armed);
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.finish_proactive_message(
    p_owner bigint,
    p_id bigint,
    p_status text,
    p_delivered timestamptz,
    p_follow_up bigint,
    p_event text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_status IS NULL OR p_status NOT IN ('INBOX', 'CANCELLED', 'EXPIRED', 'SILENT') THEN
        RAISE EXCEPTION 'proactive: message status is not allowed';
    END IF;
    UPDATE vc.proactive_message
       SET status = p_status,
           delivered_at = CASE WHEN p_status = 'INBOX' THEN p_delivered ELSE delivered_at END,
           follow_up_id = COALESCE(p_follow_up, follow_up_id),
           event_id = COALESCE(NULLIF(btrim(p_event), ''), event_id)
     WHERE owner_user_id = p_owner AND id = p_id AND status = 'READY';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'proactive: message not found';
    END IF;
END;
$$;

CREATE FUNCTION vc.cancel_open_proactive(p_owner bigint, p_relationship bigint, p_spoken timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.proactive_message
       SET status = 'CANCELLED'
     WHERE owner_user_id = p_owner
       AND relationship_id = p_relationship
       AND status = 'READY'
       AND NOT reminder
       AND (armed_at IS NULL OR p_spoken IS NULL OR armed_at < p_spoken);
END;
$$;

CREATE FUNCTION vc.save_proactive_cooldown(
    p_owner bigint,
    p_relationship bigint,
    p_key text,
    p_until timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    INSERT INTO vc.proactive_cooldown(owner_user_id, relationship_id, cooldown_key, until_at)
    VALUES (p_owner, p_relationship, p_key, p_until)
    ON CONFLICT (owner_user_id, relationship_id, cooldown_key) DO UPDATE
        SET until_at = GREATEST(vc.proactive_cooldown.until_at, EXCLUDED.until_at);
END;
$$;

CREATE FUNCTION vc.note_proactive_judgment(p_owner bigint, p_relationship bigint, p_at timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    INSERT INTO vc.companion_affect(owner_user_id, relationship_id, last_judgment_at)
    VALUES (p_owner, p_relationship, p_at)
    ON CONFLICT (owner_user_id, relationship_id) DO UPDATE
        SET last_judgment_at = EXCLUDED.last_judgment_at;
END;
$$;

CREATE FUNCTION vc.note_proactive_sent(p_owner bigint, p_relationship bigint, p_at timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    INSERT INTO vc.companion_affect(owner_user_id, relationship_id, unanswered, last_proactive_at)
    VALUES (p_owner, p_relationship, 1, p_at)
    ON CONFLICT (owner_user_id, relationship_id) DO UPDATE
        SET unanswered = LEAST(100, vc.companion_affect.unanswered + 1),
            last_proactive_at = EXCLUDED.last_proactive_at;
END;
$$;

CREATE FUNCTION vc.insert_proactive_work_item(p_owner bigint, p_relationship bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    v_id := nextval('vc.work_item_id_seq');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status, finished_at)
    VALUES (p_owner, v_id, 'PROACTIVE', p_relationship, 'DONE', clock_timestamp());
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.suppress_proactive_sources(p_owner bigint, p_chat text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_count integer;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.st_message_source s
       SET suppressed = true
      FROM vc.conversation c
      JOIN vc.proactive_message m
        ON m.owner_user_id = c.owner_user_id
       AND m.relationship_id = c.relationship_id
       AND m.status = 'INBOX'
       AND m.body IS NOT NULL
     WHERE s.owner_user_id = p_owner
       AND c.owner_user_id = p_owner
       AND c.st_chat_identity = p_chat
       AND s.conversation_id = c.id
       AND s.role = 'assistant'
       AND s.present
       AND NOT s.suppressed
       AND s.content_cipher = m.body;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE FUNCTION vc.list_proactive_targets()
    RETURNS TABLE(out_owner bigint, out_relationship bigint)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT p.owner_user_id, p.relationship_id
      FROM vc.proactive_policy p
     WHERE p.enabled
       AND p.mode IN ('DAILY', 'CLOSE_FRIEND');
$$;

CREATE OR REPLACE FUNCTION vc.create_relationship(p_owner_user_id bigint, p_persona_ref text)
    RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_persona_ref IS NULL OR btrim(p_persona_ref) = '' THEN
        RAISE EXCEPTION 'create_relationship: persona_ref is required';
    END IF;
    v_id := nextval('vc.relationship_id_seq');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (p_owner_user_id, v_id, p_persona_ref, true);
    PERFORM vc.put_proactive_policy(
        p_owner_user_id, v_id, true,
        '23:00', '08:00', 'Asia/Shanghai',
        3, 0, ARRAY['COMPANION']::text[], false,
        'CLOSE_FRIEND', 720);
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION
    vc.put_proactive_policy(bigint, bigint, boolean, text, text, text, integer, integer, text[], boolean, text, integer),
    vc.get_proactive_policy(bigint, bigint),
    vc.save_companion_affect(bigint, bigint, integer, integer, integer, integer, integer, integer, timestamptz, text, timestamptz, integer, timestamptz, timestamptz, timestamptz),
    vc.save_companion_mood(bigint, bigint, date, text, text, text, boolean),
    vc.insert_proactive_message(bigint, bigint, text, text, text, boolean, text, text, timestamptz, timestamptz),
    vc.finish_proactive_message(bigint, bigint, text, timestamptz, bigint, text),
    vc.cancel_open_proactive(bigint, bigint, timestamptz),
    vc.save_proactive_cooldown(bigint, bigint, text, timestamptz),
    vc.note_proactive_judgment(bigint, bigint, timestamptz),
    vc.note_proactive_sent(bigint, bigint, timestamptz),
    vc.insert_proactive_work_item(bigint, bigint),
    vc.suppress_proactive_sources(bigint, text),
    vc.list_proactive_targets()
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.put_proactive_policy(bigint, bigint, boolean, text, text, text, integer, integer, text[], boolean, text, integer),
    vc.get_proactive_policy(bigint, bigint),
    vc.save_companion_affect(bigint, bigint, integer, integer, integer, integer, integer, integer, timestamptz, text, timestamptz, integer, timestamptz, timestamptz, timestamptz),
    vc.save_companion_mood(bigint, bigint, date, text, text, text, boolean),
    vc.insert_proactive_message(bigint, bigint, text, text, text, boolean, text, text, timestamptz, timestamptz),
    vc.finish_proactive_message(bigint, bigint, text, timestamptz, bigint, text),
    vc.cancel_open_proactive(bigint, bigint, timestamptz),
    vc.save_proactive_cooldown(bigint, bigint, text, timestamptz),
    vc.note_proactive_judgment(bigint, bigint, timestamptz),
    vc.note_proactive_sent(bigint, bigint, timestamptz),
    vc.insert_proactive_work_item(bigint, bigint),
    vc.suppress_proactive_sources(bigint, text),
    vc.list_proactive_targets()
    TO vc_api, vc_worker;
