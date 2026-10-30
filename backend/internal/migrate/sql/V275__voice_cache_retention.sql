-- VO-10: bounded preview reuse and existing-object cleanup; source-owned ready speech remains retained.
ALTER TABLE vc.voice_clip ADD COLUMN storage_bytes bigint NOT NULL DEFAULT 0 CHECK(storage_bytes>=0);
CREATE INDEX voice_preview_cache ON vc.voice_clip(owner_user_id,relationship_id,engine,voice,created_at DESC)
 WHERE purpose='preview' AND status IN ('queued','running','ready');
CREATE INDEX voice_clip_retention ON vc.voice_clip(created_at)
 WHERE purpose='preview' OR status IN ('queued','failed','expired');
CREATE OR REPLACE FUNCTION vc.enqueue_voice_clip(p_owner bigint, p_relationship bigint, p_ref text, p_purpose text,
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
    IF p_purpose='preview' THEN
        SELECT * INTO v_row FROM vc.voice_clip WHERE owner_user_id=p_owner AND relationship_id=p_relationship
            AND purpose='preview' AND engine=p_engine AND voice=p_voice AND text=p_text
            AND params-'timeoutSeconds'=p_params-'timeoutSeconds'
            AND status IN ('queued','running','ready') AND created_at>clock_timestamp()-interval '24 hours'
            ORDER BY created_at DESC,id DESC LIMIT 1;
        IF FOUND THEN RETURN v_row; END IF;
    END IF;
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


CREATE FUNCTION vc.record_voice_size(p_owner bigint,p_clip bigint,p_bytes bigint) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_bytes<0 OR p_bytes>34603008 THEN RAISE EXCEPTION 'voice: invalid storage size'; END IF;
 UPDATE vc.voice_clip SET storage_bytes=p_bytes WHERE owner_user_id=p_owner AND id=p_clip AND status='ready';
END $$;
CREATE FUNCTION vc.expire_voice_clips() RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 WITH expired AS (
  SELECT owner_user_id,id FROM vc.voice_clip
  WHERE created_at<clock_timestamp()-interval '24 hours' AND (purpose='preview' OR status IN ('queued','failed','expired'))
  ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 100
 ) DELETE FROM vc.voice_clip c USING expired e WHERE (c.owner_user_id,c.id)=(e.owner_user_id,e.id)
$$;
REVOKE ALL ON FUNCTION vc.record_voice_size(bigint,bigint,bigint),vc.expire_voice_clips() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_voice_size(bigint,bigint,bigint),vc.expire_voice_clips() TO vc_api;
