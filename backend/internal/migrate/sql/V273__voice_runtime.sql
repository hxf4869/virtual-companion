-- VO-2: controlled voice settings writes, per-engine durable workers and
-- deletion cleanup. No direct runtime DML grants or engine/network addresses.
SET search_path TO vc, pg_catalog;

ALTER TABLE vc.voice_settings
    ADD CONSTRAINT voice_settings_kokoro_timeout_bound CHECK (kokoro_timeout_seconds <= 3600),
    ADD CONSTRAINT voice_settings_cosy_timeout_bound CHECK (cosy_voice_timeout_seconds <= 3600),
    ADD CONSTRAINT voice_settings_asr_timeout_bound CHECK (asr_timeout_seconds <= 120);

-- A cascade must retain the only object pointer, even after its owner is gone.
-- Running writes finish inside available_at; cleanup waits past that deadline.
CREATE TABLE vc.voice_object_cleanup (
    object_key text PRIMARY KEY,
    owner_user_id bigint NOT NULL,
    not_before timestamptz NOT NULL,
    CHECK (object_key LIKE owner_user_id::text || '/%')
);
ALTER TABLE vc.voice_object_cleanup ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.voice_object_cleanup FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.voice_object_cleanup FOR ALL TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id()) WITH CHECK (owner_user_id = vc.current_owner_id());
REVOKE ALL ON vc.voice_object_cleanup FROM PUBLIC;

CREATE FUNCTION vc.save_voice_settings(p_owner bigint, p_expected bigint, p_values jsonb)
RETURNS vc.voice_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE v_current bigint; v_row vc.voice_settings;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM 1 FROM vc.vc_user WHERE id = p_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'voice: not found'; END IF;
    IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion is in progress'; END IF;
    SELECT revision INTO v_current FROM vc.voice_settings WHERE owner_user_id = p_owner;
    v_current := COALESCE(v_current, 0);
    IF p_expected IS DISTINCT FROM v_current THEN
        RAISE EXCEPTION 'revision conflict (current %)', v_current;
    END IF;
    INSERT INTO vc.voice_settings(owner_user_id, revision, kokoro_enabled, cosy_voice_enabled, asr_enabled,
        kokoro_timeout_seconds, cosy_voice_timeout_seconds, asr_timeout_seconds, daily_chat_limit,
        daily_proactive_limit, voice_frequency, cosy_voice_instructions, kokoro_mood_speeds, max_recording_seconds)
    VALUES (p_owner, v_current + 1, (p_values->>'kokoroEnabled')::boolean,
        (p_values->>'cosyVoiceEnabled')::boolean, (p_values->>'asrEnabled')::boolean,
        (p_values->>'kokoroTimeoutSeconds')::integer, (p_values->>'cosyVoiceTimeoutSeconds')::integer,
        (p_values->>'asrTimeoutSeconds')::integer, (p_values->>'dailyChatLimit')::integer,
        (p_values->>'dailyProactiveLimit')::integer, p_values->>'voiceFrequency',
        p_values->'cosyVoiceInstructions', p_values->'kokoroMoodSpeeds', (p_values->>'maxRecordingSeconds')::integer)
    ON CONFLICT (owner_user_id) DO UPDATE SET revision = EXCLUDED.revision,
        kokoro_enabled = EXCLUDED.kokoro_enabled, cosy_voice_enabled = EXCLUDED.cosy_voice_enabled,
        asr_enabled = EXCLUDED.asr_enabled, kokoro_timeout_seconds = EXCLUDED.kokoro_timeout_seconds,
        cosy_voice_timeout_seconds = EXCLUDED.cosy_voice_timeout_seconds, asr_timeout_seconds = EXCLUDED.asr_timeout_seconds,
        daily_chat_limit = EXCLUDED.daily_chat_limit, daily_proactive_limit = EXCLUDED.daily_proactive_limit,
        voice_frequency = EXCLUDED.voice_frequency, cosy_voice_instructions = EXCLUDED.cosy_voice_instructions,
        kokoro_mood_speeds = EXCLUDED.kokoro_mood_speeds, max_recording_seconds = EXCLUDED.max_recording_seconds,
        updated_at = clock_timestamp()
    RETURNING * INTO v_row;
    RETURN v_row;
END $$;

CREATE FUNCTION vc.put_relationship_voice(p_owner bigint, p_relationship bigint, p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion is in progress'; END IF;
    UPDATE vc.relationship SET
        kokoro_voice = CASE WHEN p_patch ? 'kokoroVoice' THEN p_patch->>'kokoroVoice' ELSE kokoro_voice END,
        cosy_voice = CASE WHEN p_patch ? 'cosyVoice' THEN p_patch->>'cosyVoice' ELSE cosy_voice END,
        voice_speed = CASE WHEN p_patch ? 'speed' THEN (p_patch->>'speed')::double precision ELSE voice_speed END,
        voice_frequency = CASE WHEN p_patch ? 'voiceFrequency' THEN p_patch->>'voiceFrequency' ELSE voice_frequency END,
        proactive_voice = CASE WHEN p_patch ? 'proactiveVoice' THEN (p_patch->>'proactiveVoice')::boolean ELSE proactive_voice END
    WHERE owner_user_id = p_owner AND id = p_relationship;
    IF NOT FOUND THEN RAISE EXCEPTION 'voice: not found'; END IF;
END $$;

CREATE FUNCTION vc.voice_source_text(p_owner bigint, p_relationship bigint, p_ref text, p_purpose text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE v_text text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_purpose = 'chat' THEN
        SELECT s.content_cipher INTO v_text FROM vc.st_message_source s JOIN vc.conversation c
            ON (c.owner_user_id, c.id) = (s.owner_user_id, s.conversation_id)
        WHERE s.owner_user_id = p_owner AND c.relationship_id = p_relationship
          AND s.source_ref = p_ref AND s.role = 'assistant' AND s.present AND s.settled
          AND c.st_source_state = 'PRESENT' FOR SHARE OF s, c;
    ELSIF p_purpose = 'proactive' THEN
        SELECT body INTO v_text FROM vc.proactive_message
        WHERE owner_user_id = p_owner AND relationship_id = p_relationship
          AND 'proactive:' || id::text = p_ref AND status IN ('READY', 'INBOX') FOR SHARE;
    END IF;
    RETURN v_text;
END $$;

CREATE FUNCTION vc.enqueue_voice_clip(p_owner bigint, p_relationship bigint, p_ref text, p_purpose text,
    p_engine text, p_voice text, p_params jsonb, p_text text)
RETURNS vc.voice_clip LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE v_row vc.voice_clip; v_limit integer; v_enabled boolean; v_rel vc.relationship; v_text text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM 1 FROM vc.vc_user WHERE id = p_owner FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'voice: not found'; END IF;
    IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion is in progress'; END IF;
    SELECT * INTO v_rel FROM vc.relationship WHERE owner_user_id = p_owner AND id = p_relationship;
    IF NOT FOUND THEN RAISE EXCEPTION 'voice: not found'; END IF;
    IF p_purpose <> 'preview' THEN
        v_text := vc.voice_source_text(p_owner, p_relationship, p_ref, p_purpose);
        IF v_text IS NULL THEN
            RAISE EXCEPTION 'voice: not found';
        END IF;
        IF v_text IS DISTINCT FROM p_text THEN RAISE EXCEPTION 'voice: invalid text'; END IF;
        SELECT * INTO v_row FROM vc.voice_clip WHERE owner_user_id = p_owner AND relationship_id = p_relationship
            AND purpose = p_purpose AND message_ref = p_ref;
        IF FOUND THEN RETURN v_row; END IF;
        IF v_rel.voice_frequency = 'OFF' OR (p_purpose = 'proactive' AND NOT v_rel.proactive_voice) THEN
            RAISE EXCEPTION 'voice: unavailable';
        END IF;
    END IF;
    SELECT CASE WHEN p_purpose = 'chat' THEN daily_chat_limit ELSE daily_proactive_limit END,
           CASE WHEN p_engine = 'kokoro' THEN kokoro_enabled ELSE cosy_voice_enabled END
        INTO v_limit, v_enabled FROM vc.voice_settings WHERE owner_user_id = p_owner;
    IF v_enabled IS FALSE THEN RAISE EXCEPTION 'voice: unavailable'; END IF;
    IF p_purpose <> 'preview' THEN
        v_limit := COALESCE(v_limit, CASE WHEN p_purpose = 'chat' THEN 60 ELSE 8 END);
        IF (SELECT count(*) FROM vc.voice_clip WHERE owner_user_id = p_owner AND purpose = p_purpose
            AND created_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai') >= v_limit THEN
            RAISE EXCEPTION 'voice: rate limited';
        END IF;
    END IF;
    IF NOT COALESCE((p_params->>'timeoutSeconds')::integer BETWEEN 1 AND 3600, false) THEN
        RAISE EXCEPTION 'voice: invalid parameters';
    END IF;
    PERFORM pg_advisory_xact_lock(273, CASE WHEN p_engine = 'kokoro' THEN 1 ELSE 2 END);
    IF (SELECT count(*) FROM vc.voice_clip WHERE engine = p_engine AND status IN ('queued', 'running')) >= 100 THEN
        RAISE EXCEPTION 'voice: rate limited';
    END IF;
    INSERT INTO vc.voice_clip(owner_user_id, relationship_id, message_ref, purpose, engine, voice, params, text)
    VALUES(p_owner, p_relationship, p_ref, p_purpose, p_engine, p_voice, p_params, p_text)
    RETURNING * INTO v_row;
    RETURN v_row;
END $$;

CREATE FUNCTION vc.claim_voice_clip(p_engine text)
RETURNS SETOF vc.voice_clip LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE v_row vc.voice_clip;
BEGIN
    IF p_engine IS NULL OR p_engine NOT IN ('kokoro','cosyvoice') THEN RETURN; END IF;
    PERFORM pg_advisory_xact_lock(273, CASE WHEN p_engine = 'kokoro' THEN 1 ELSE 2 END);
    -- A crashed or deadline-expired call falls back to text; it is never
    -- replayed under the same audio key. Only a completed 429 is retried.
    UPDATE vc.voice_clip SET status = 'failed', error_kind = 'timeout'
        WHERE engine = p_engine AND status = 'running' AND available_at < clock_timestamp();
    IF EXISTS (SELECT 1 FROM vc.voice_clip WHERE engine = p_engine AND status = 'running') THEN RETURN; END IF;
    SELECT * INTO v_row FROM vc.voice_clip c
        WHERE c.engine = p_engine AND c.status = 'queued' AND c.available_at <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM vc.account_deletion_intent d WHERE d.account_id = c.owner_user_id)
        ORDER BY CASE c.purpose WHEN 'chat' THEN 0 WHEN 'preview' THEN 1 ELSE 2 END, c.created_at, c.id
        FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE vc.voice_clip SET status = 'running', started_at = clock_timestamp(),
        available_at = clock_timestamp() + make_interval(secs => (params->>'timeoutSeconds')::integer + 30),
        object_key = owner_user_id::text || '/' || relationship_id::text || '/' || id::text || '.wav'
        WHERE owner_user_id = v_row.owner_user_id AND id = v_row.id
        RETURNING * INTO v_row;
    RETURN NEXT v_row;
END $$;

CREATE FUNCTION vc.complete_voice_clip(p_owner bigint, p_id bigint, p_started timestamptz,
    p_status text, p_error text, p_duration integer, p_generation integer, p_delay integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE v_row vc.voice_clip; v_source text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    -- Source reconciliation locks its source before deleting dependent clips.
    -- Use the same order, so an edit cannot deadlock with ready publication.
    SELECT * INTO v_row FROM vc.voice_clip WHERE owner_user_id = p_owner AND id = p_id;
    IF NOT FOUND THEN RETURN false; END IF;
    IF p_status = 'ready' AND v_row.purpose <> 'preview' THEN
        v_source := vc.voice_source_text(p_owner, v_row.relationship_id, v_row.message_ref, v_row.purpose);
    END IF;
    SELECT * INTO v_row FROM vc.voice_clip WHERE owner_user_id = p_owner AND id = p_id FOR UPDATE;
    IF NOT FOUND OR v_row.status <> 'running' OR v_row.started_at IS DISTINCT FROM p_started
       OR v_row.available_at < clock_timestamp() THEN RETURN false; END IF;
    IF p_status IS NULL OR p_status NOT IN ('queued', 'ready', 'failed') THEN
        RAISE EXCEPTION 'voice: invalid completion';
    END IF;
    IF p_status = 'queued' AND (v_row.retry_count >= 3 OR p_delay NOT BETWEEN 1 AND 60) THEN
        RAISE EXCEPTION 'voice: invalid retry';
    END IF;
    IF p_status = 'ready' AND (vc.account_deletion_intent_active_current()
       OR (v_row.purpose <> 'preview' AND v_source IS NULL)) THEN
        DELETE FROM vc.voice_clip WHERE owner_user_id = p_owner AND id = p_id;
        RETURN false;
    END IF;
    UPDATE vc.voice_clip SET status = p_status, error_kind = NULLIF(p_error, ''),
        duration_ms = CASE WHEN p_status = 'ready' THEN p_duration ELSE NULL END,
        generation_ms = p_generation,
        ready_at = CASE WHEN p_status = 'ready' THEN clock_timestamp() ELSE NULL END,
        retry_count = retry_count + CASE WHEN p_status = 'queued' THEN 1 ELSE 0 END,
        available_at = CASE WHEN p_status = 'queued' THEN clock_timestamp() + make_interval(secs => p_delay) ELSE available_at END,
        object_key = CASE WHEN p_status = 'queued' OR (p_status = 'failed' AND p_error <> 'storage_error') THEN NULL ELSE object_key END,
        started_at = CASE WHEN p_status = 'queued' THEN NULL ELSE started_at END
    WHERE owner_user_id = p_owner AND id = p_id;
    RETURN true;
END $$;

CREATE FUNCTION vc.queue_voice_object_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    IF OLD.object_key IS NOT NULL THEN
        INSERT INTO vc.voice_object_cleanup(owner_user_id, object_key, not_before)
        VALUES (OLD.owner_user_id, OLD.object_key,
            CASE WHEN OLD.status = 'running' THEN greatest(clock_timestamp(), OLD.available_at) + interval '15 seconds'
                 ELSE clock_timestamp() END)
        ON CONFLICT (object_key) DO UPDATE SET not_before = greatest(vc.voice_object_cleanup.not_before, EXCLUDED.not_before);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER voice_deleted_object AFTER DELETE ON vc.voice_clip FOR EACH ROW EXECUTE FUNCTION vc.queue_voice_object_cleanup();
CREATE TRIGGER voice_failed_object AFTER UPDATE OF status ON vc.voice_clip FOR EACH ROW
    WHEN (NEW.status IN ('failed','expired') AND NEW.object_key IS NOT NULL AND OLD.status IS DISTINCT FROM NEW.status)
    EXECUTE FUNCTION vc.queue_voice_object_cleanup();

CREATE FUNCTION vc.clear_source_voice_clips()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    IF TG_TABLE_NAME = 'st_message_source' THEN
        IF TG_OP = 'DELETE' THEN
            DELETE FROM vc.voice_clip WHERE owner_user_id = OLD.owner_user_id AND purpose = 'chat' AND message_ref = OLD.source_ref;
        ELSIF NOT NEW.present OR OLD.source_ref IS DISTINCT FROM NEW.source_ref OR OLD.content_cipher IS DISTINCT FROM NEW.content_cipher THEN
            DELETE FROM vc.voice_clip WHERE owner_user_id = OLD.owner_user_id AND purpose = 'chat' AND message_ref = OLD.source_ref;
        END IF;
    ELSE
        IF TG_OP = 'DELETE' THEN
            DELETE FROM vc.voice_clip WHERE owner_user_id = OLD.owner_user_id AND purpose = 'proactive' AND message_ref = 'proactive:' || OLD.id::text;
        ELSIF NEW.status IN ('CANCELLED','EXPIRED','SILENT') THEN
            DELETE FROM vc.voice_clip WHERE owner_user_id = OLD.owner_user_id AND purpose = 'proactive' AND message_ref = 'proactive:' || OLD.id::text;
        END IF;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER voice_st_source_deleted AFTER DELETE ON vc.st_message_source FOR EACH ROW EXECUTE FUNCTION vc.clear_source_voice_clips();
CREATE TRIGGER voice_st_source_changed AFTER UPDATE OF present, source_ref, content_cipher ON vc.st_message_source FOR EACH ROW EXECUTE FUNCTION vc.clear_source_voice_clips();
CREATE TRIGGER voice_proactive_deleted AFTER DELETE ON vc.proactive_message FOR EACH ROW EXECUTE FUNCTION vc.clear_source_voice_clips();
CREATE TRIGGER voice_proactive_cancelled AFTER UPDATE OF status ON vc.proactive_message FOR EACH ROW EXECUTE FUNCTION vc.clear_source_voice_clips();

CREATE FUNCTION vc.list_voice_cleanup()
RETURNS TABLE(object_key text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
    SELECT q.object_key FROM vc.voice_object_cleanup q WHERE not_before <= clock_timestamp() ORDER BY not_before LIMIT 100
$$;
CREATE FUNCTION vc.complete_voice_cleanup(p_key text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
    DELETE FROM vc.voice_object_cleanup WHERE object_key = p_key AND not_before <= clock_timestamp()
$$;
CREATE FUNCTION vc.clear_relationship_voice(p_owner bigint, p_relationship bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    DELETE FROM vc.voice_clip WHERE owner_user_id = p_owner AND relationship_id = p_relationship;
END $$;
CREATE FUNCTION vc.clear_voice_account_data(p_owner bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion intent is required'; END IF;
    DELETE FROM vc.voice_clip WHERE owner_user_id = p_owner;
    RETURN NOT EXISTS (SELECT 1 FROM vc.voice_object_cleanup WHERE owner_user_id = p_owner);
END $$;

REVOKE ALL ON FUNCTION vc.save_voice_settings(bigint,bigint,jsonb),vc.put_relationship_voice(bigint,bigint,jsonb),
    vc.voice_source_text(bigint,bigint,text,text),vc.enqueue_voice_clip(bigint,bigint,text,text,text,text,jsonb,text),
    vc.claim_voice_clip(text),vc.complete_voice_clip(bigint,bigint,timestamptz,text,text,integer,integer,integer),
    vc.queue_voice_object_cleanup(),vc.clear_source_voice_clips(),vc.list_voice_cleanup(),vc.complete_voice_cleanup(text),
    vc.clear_relationship_voice(bigint,bigint),vc.clear_voice_account_data(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.save_voice_settings(bigint,bigint,jsonb),vc.put_relationship_voice(bigint,bigint,jsonb),
    vc.voice_source_text(bigint,bigint,text,text),vc.enqueue_voice_clip(bigint,bigint,text,text,text,text,jsonb,text),
    vc.claim_voice_clip(text),vc.complete_voice_clip(bigint,bigint,timestamptz,text,text,integer,integer,integer),
    vc.list_voice_cleanup(),vc.complete_voice_cleanup(text),vc.clear_relationship_voice(bigint,bigint),
    vc.clear_voice_account_data(bigint) TO vc_api;

-- Extend existing named result columns; older runtimes still select their
-- original columns by name during the deployment transition.
DROP FUNCTION vc.get_relationship(bigint,bigint);
DROP FUNCTION vc.list_relationships(bigint);
CREATE OR REPLACE FUNCTION vc.get_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS TABLE(
        out_id bigint,
        out_persona_ref text,
        out_active boolean,
        out_created_at timestamptz,
        out_companion_name text,
        out_user_address_as text,
        out_reply_length text,
        out_initiative text,
        out_humor text,
        out_advice_pref text,
        out_reminders_allowed boolean,
        out_memory_share_scope text,
        out_avoid_topics text,
        out_gender text,
        out_avatar_ref text,
        out_kokoro_voice text, out_cosy_voice text, out_voice_speed double precision,
        out_voice_frequency text, out_proactive_voice boolean
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_rel_id IS NULL THEN
        RAISE EXCEPTION 'get_relationship: owner_user_id and relationship id are required';
    END IF;
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at,
               r.companion_name, r.user_address_as, r.reply_length,
               r.initiative, r.humor, r.advice_pref, r.reminders_allowed,
               r.memory_share_scope, r.avoid_topics, r.gender, r.avatar_ref, r.kokoro_voice, r.cosy_voice, r.voice_speed, r.voice_frequency, r.proactive_voice
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
           AND r.id = p_rel_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.list_relationships(
    p_owner_user_id bigint
)
    RETURNS TABLE(
        out_id bigint,
        out_persona_ref text,
        out_active boolean,
        out_created_at timestamptz,
        out_companion_name text,
        out_user_address_as text,
        out_reply_length text,
        out_initiative text,
        out_humor text,
        out_advice_pref text,
        out_reminders_allowed boolean,
        out_memory_share_scope text,
        out_avoid_topics text,
        out_gender text,
        out_avatar_ref text,
        out_kokoro_voice text, out_cosy_voice text, out_voice_speed double precision,
        out_voice_frequency text, out_proactive_voice boolean
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at,
               r.companion_name, r.user_address_as, r.reply_length,
               r.initiative, r.humor, r.advice_pref, r.reminders_allowed,
               r.memory_share_scope, r.avoid_topics, r.gender, r.avatar_ref, r.kokoro_voice, r.cosy_voice, r.voice_speed, r.voice_frequency, r.proactive_voice
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
         ORDER BY r.created_at, r.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.get_relationship(bigint,bigint),vc.list_relationships(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.get_relationship(bigint,bigint),vc.list_relationships(bigint) TO vc_api;
