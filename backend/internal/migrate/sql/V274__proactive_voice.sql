-- VO-5: one durable voice choice per proactive plan; freeze ready audio at delivery.
ALTER TABLE vc.voice_settings ADD COLUMN proactive_voice_rates jsonb NOT NULL DEFAULT '{"morning":1,"night":1,"care":0.5,"share":0.3,"default":0}';
ALTER TABLE vc.voice_settings ADD CONSTRAINT proactive_voice_rates_shape CHECK (
 jsonb_typeof(proactive_voice_rates)='object' AND proactive_voice_rates ?& ARRAY['morning','night','care','share','default']
 AND (proactive_voice_rates->>'morning')::numeric BETWEEN 0 AND 1 AND (proactive_voice_rates->>'night')::numeric BETWEEN 0 AND 1
 AND (proactive_voice_rates->>'care')::numeric BETWEEN 0 AND 1 AND (proactive_voice_rates->>'share')::numeric BETWEEN 0 AND 1
 AND (proactive_voice_rates->>'default')::numeric BETWEEN 0 AND 1);
ALTER TABLE vc.relationship ADD COLUMN proactive_engine text CHECK (proactive_engine IN ('kokoro','cosyvoice'));
ALTER TABLE vc.proactive_message ADD COLUMN voice_selected boolean;
ALTER TABLE vc.inbox_event ADD COLUMN voice_clip_id bigint;
ALTER TABLE vc.inbox_event ADD CONSTRAINT inbox_voice_clip_fk FOREIGN KEY(owner_user_id,voice_clip_id)
 REFERENCES vc.voice_clip(owner_user_id,id) ON DELETE SET NULL (voice_clip_id);

CREATE FUNCTION vc.select_proactive_voice(p_owner bigint,p_id bigint,p_selected boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.proactive_message SET voice_selected=p_selected WHERE owner_user_id=p_owner AND id=p_id AND status='READY' AND voice_selected IS NULL;
END $$;
CREATE FUNCTION vc.attach_inbox_voice(p_owner bigint,p_event text,p_proactive bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.inbox_event i SET voice_clip_id=c.id FROM vc.voice_clip c
 WHERE i.owner_user_id=p_owner AND i.event_id=p_event AND c.owner_user_id=i.owner_user_id
 AND c.relationship_id=i.relationship_id AND c.message_ref='proactive:'||p_proactive::text
 AND c.purpose='proactive' AND c.status='ready' AND c.text=i.body;
END $$;
REVOKE ALL ON FUNCTION vc.select_proactive_voice(bigint,bigint,boolean),vc.attach_inbox_voice(bigint,text,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.select_proactive_voice(bigint,bigint,boolean),vc.attach_inbox_voice(bigint,text,bigint) TO vc_api;

CREATE OR REPLACE FUNCTION vc.save_voice_settings(p_owner bigint, p_expected bigint, p_values jsonb)
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
        daily_proactive_limit, voice_frequency, cosy_voice_instructions, proactive_voice_rates, kokoro_mood_speeds, max_recording_seconds)
    VALUES (p_owner, v_current + 1, (p_values->>'kokoroEnabled')::boolean,
        (p_values->>'cosyVoiceEnabled')::boolean, (p_values->>'asrEnabled')::boolean,
        (p_values->>'kokoroTimeoutSeconds')::integer, (p_values->>'cosyVoiceTimeoutSeconds')::integer,
        (p_values->>'asrTimeoutSeconds')::integer, (p_values->>'dailyChatLimit')::integer,
        (p_values->>'dailyProactiveLimit')::integer, p_values->>'voiceFrequency',
        p_values->'cosyVoiceInstructions', COALESCE(p_values->'proactiveVoiceRates','{"morning":1,"night":1,"care":0.5,"share":0.3,"default":0}'::jsonb), p_values->'kokoroMoodSpeeds', (p_values->>'maxRecordingSeconds')::integer)
    ON CONFLICT (owner_user_id) DO UPDATE SET revision = EXCLUDED.revision,
        kokoro_enabled = EXCLUDED.kokoro_enabled, cosy_voice_enabled = EXCLUDED.cosy_voice_enabled,
        asr_enabled = EXCLUDED.asr_enabled, kokoro_timeout_seconds = EXCLUDED.kokoro_timeout_seconds,
        cosy_voice_timeout_seconds = EXCLUDED.cosy_voice_timeout_seconds, asr_timeout_seconds = EXCLUDED.asr_timeout_seconds,
        daily_chat_limit = EXCLUDED.daily_chat_limit, daily_proactive_limit = EXCLUDED.daily_proactive_limit,
        voice_frequency = EXCLUDED.voice_frequency, cosy_voice_instructions = EXCLUDED.cosy_voice_instructions, proactive_voice_rates=EXCLUDED.proactive_voice_rates,
        kokoro_mood_speeds = EXCLUDED.kokoro_mood_speeds, max_recording_seconds = EXCLUDED.max_recording_seconds,
        updated_at = clock_timestamp()
    RETURNING * INTO v_row;
    RETURN v_row;
END $$;

CREATE OR REPLACE FUNCTION vc.put_relationship_voice(p_owner bigint, p_relationship bigint, p_patch jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion is in progress'; END IF;
    UPDATE vc.relationship SET
        kokoro_voice = CASE WHEN p_patch ? 'kokoroVoice' THEN p_patch->>'kokoroVoice' ELSE kokoro_voice END,
        cosy_voice = CASE WHEN p_patch ? 'cosyVoice' THEN p_patch->>'cosyVoice' ELSE cosy_voice END,
        voice_speed = CASE WHEN p_patch ? 'speed' THEN (p_patch->>'speed')::double precision ELSE voice_speed END,
        voice_frequency = CASE WHEN p_patch ? 'voiceFrequency' THEN p_patch->>'voiceFrequency' ELSE voice_frequency END,
        proactive_engine = CASE WHEN p_patch ? 'proactiveEngine' THEN p_patch->>'proactiveEngine' ELSE proactive_engine END,
        proactive_voice = CASE WHEN p_patch ? 'proactiveVoice' THEN (p_patch->>'proactiveVoice')::boolean ELSE proactive_voice END
    WHERE owner_user_id = p_owner AND id = p_relationship;
    IF NOT FOUND THEN RAISE EXCEPTION 'voice: not found'; END IF;
END $$;

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
        out_voice_frequency text, out_proactive_voice boolean, out_proactive_engine text
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
               r.memory_share_scope, r.avoid_topics, r.gender, r.avatar_ref, r.kokoro_voice, r.cosy_voice, r.voice_speed, r.voice_frequency, r.proactive_voice, r.proactive_engine
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
        out_voice_frequency text, out_proactive_voice boolean, out_proactive_engine text
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
               r.memory_share_scope, r.avoid_topics, r.gender, r.avatar_ref, r.kokoro_voice, r.cosy_voice, r.voice_speed, r.voice_frequency, r.proactive_voice, r.proactive_engine
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
         ORDER BY r.created_at, r.id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.get_relationship(bigint,bigint),vc.list_relationships(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.get_relationship(bigint,bigint),vc.list_relationships(bigint) TO vc_api;
