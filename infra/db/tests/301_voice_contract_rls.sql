-- VO-1: owner isolation, inherited defaults, durable queue constraints and
-- relationship/account cascades. Fixtures contain no real text or audio.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (27201, 'voice fixture A'), (27202, 'voice fixture B');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, gender, avatar_ref) VALUES
    (27201, 27210, 'voice-fixture', 'MALE', 'AVATAR_MALE_01'),
    (27202, 27211, 'voice-fixture', 'FEMALE', 'AVATAR_FEMALE_01');
INSERT INTO vc.voice_settings(owner_user_id) VALUES (27201), (27202);
INSERT INTO vc.voice_clip(owner_user_id, id, relationship_id, message_ref, purpose, engine, voice, text) VALUES
    (27201, 27220, 27210, 'st:voice-fixture-a', 'chat', 'kokoro', 'zm_010', 'synthetic fixture'),
    (27202, 27221, 27211, 'st:voice-fixture-b', 'chat', 'kokoro', 'zf_001', 'synthetic fixture');

DO $$
DECLARE
    v_sql text;
    v_state text;
BEGIN
    IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'vc' AND c.relname IN ('voice_settings', 'voice_clip')
           AND c.relrowsecurity AND c.relforcerowsecurity) <> 2 THEN
        RAISE EXCEPTION 'voice tables must force RLS';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.voice_settings WHERE owner_user_id = 27201
        AND revision = 1 AND kokoro_enabled AND cosy_voice_enabled AND asr_enabled
        AND kokoro_timeout_seconds = 60 AND cosy_voice_timeout_seconds = 300 AND asr_timeout_seconds = 30
        AND daily_chat_limit = 60 AND daily_proactive_limit = 8 AND voice_frequency = 'STANDARD'
        AND max_recording_seconds = 60 AND kokoro_mood_speeds->>'开心' = '1.05'
        AND cosy_voice_instructions->>'default' = 'You are a helpful assistant.') THEN
        RAISE EXCEPTION 'voice settings defaults differ from the contract';
    END IF;
    IF (SELECT count(*) FROM vc.relationship WHERE owner_user_id IN (27201, 27202)
        AND kokoro_voice IS NULL AND cosy_voice IS NULL AND voice_frequency IS NULL
        AND voice_speed = 1.0 AND proactive_voice) <> 2 THEN
        RAISE EXCEPTION 'relationship voice defaults must inherit gender and owner frequency';
    END IF;
    -- Invalid externally reachable values must not enter durable state.
    FOR v_sql, v_state IN SELECT * FROM (VALUES
        ('UPDATE vc.voice_clip SET engine = ''unknown'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET purpose = ''unknown'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET status = ''unknown'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET params = ''[]''::jsonb WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET status = ''ready'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET status = ''failed'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET error_kind = ''timeout'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET retry_count = 4 WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET object_key = ''27202/27211/27220.wav'' WHERE id = 27220', '23514'),
        ('UPDATE vc.voice_clip SET relationship_id = 27211 WHERE id = 27220', '23503'),
        ('UPDATE vc.voice_settings SET revision = 0 WHERE owner_user_id = 27201', '23514'),
        ('UPDATE vc.voice_settings SET max_recording_seconds = 61 WHERE owner_user_id = 27201', '23514'),
        ('UPDATE vc.relationship SET voice_speed = 0.4 WHERE id = 27210', '23514'),
        ('UPDATE vc.relationship SET voice_frequency = ''unknown'' WHERE id = 27210', '23514'),
        ('INSERT INTO vc.voice_clip(owner_user_id,id,relationship_id,message_ref,purpose,engine,voice,text)
          VALUES(27201,27222,27210,''st:voice-fixture-a'',''chat'',''kokoro'',''zm_010'',''fixture'')', '23505')
    ) AS cases(statement, expected_state)
    LOOP
        BEGIN
            EXECUTE v_sql;
            RAISE EXCEPTION 'invalid voice state was accepted';
        EXCEPTION WHEN OTHERS THEN
            IF SQLSTATE <> v_state THEN RAISE; END IF;
        END;
    END LOOP;
    UPDATE vc.voice_clip SET status = 'running', started_at = clock_timestamp() WHERE id = 27220;
    BEGIN
        UPDATE vc.voice_clip SET status = 'running' WHERE id = 27221;
        RAISE EXCEPTION 'two owners ran the same TTS engine concurrently';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    UPDATE vc.voice_clip SET status = 'running', engine = 'cosyvoice' WHERE id = 27221;
    UPDATE vc.voice_clip SET status = 'queued', started_at = NULL WHERE id IN (27220, 27221);
END $$;

BEGIN;
SELECT vc.set_owner_context(27201, 'voice-a', encode(vc.hmac(convert_to('vc-owner-binding-v1|27201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|voice-a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.voice_settings) <> 1 OR (SELECT count(*) FROM vc.voice_clip) <> 1
       OR NOT EXISTS (SELECT 1 FROM vc.voice_clip WHERE id = 27220) THEN
        RAISE EXCEPTION 'API owner read isolation failed';
    END IF;
    BEGIN
        UPDATE vc.voice_settings SET daily_chat_limit = 1 WHERE owner_user_id = 27201;
        RAISE EXCEPTION 'API gained direct voice settings writes';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM vc.voice_clip WHERE id = 27220;
        RAISE EXCEPTION 'API gained direct voice clip writes';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;

BEGIN;
SELECT vc.set_owner_context(27202, 'voice-b', encode(vc.hmac(convert_to('vc-owner-binding-v1|27202|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|voice-b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.voice_settings) <> 1 OR (SELECT count(*) FROM vc.voice_clip) <> 1
       OR NOT EXISTS (SELECT 1 FROM vc.voice_clip WHERE id = 27221) THEN
        RAISE EXCEPTION 'worker owner read isolation failed';
    END IF;
END $$;
COMMIT;

-- Temporary DML grants let the test exercise USING / WITH CHECK themselves;
-- production privileges remain read-only after this transaction rolls back.
BEGIN;
GRANT INSERT, UPDATE, DELETE ON vc.voice_clip, vc.voice_settings TO vc_api;
SELECT vc.set_owner_context(27201, 'voice-policy', encode(vc.hmac(convert_to('vc-owner-binding-v1|27201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|voice-policy', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    INSERT INTO vc.voice_clip(owner_user_id,id,relationship_id,purpose,engine,voice,text)
        VALUES (27201,27222,27210,'preview','kokoro','zm_010','synthetic preview');
    BEGIN
        INSERT INTO vc.voice_clip(owner_user_id,id,relationship_id,purpose,engine,voice,text)
            VALUES (27202,27223,27211,'preview','kokoro','zf_001','synthetic preview');
        RAISE EXCEPTION 'clip WITH CHECK accepted a foreign owner';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE vc.voice_settings SET owner_user_id = 27202 WHERE owner_user_id = 27201;
        RAISE EXCEPTION 'settings WITH CHECK accepted a foreign owner';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE vc.voice_clip SET text = 'foreign write' WHERE owner_user_id = 27202;
    IF FOUND THEN RAISE EXCEPTION 'clip USING allowed foreign update'; END IF;
    DELETE FROM vc.voice_clip WHERE owner_user_id = 27202;
    IF FOUND THEN RAISE EXCEPTION 'clip USING allowed foreign delete'; END IF;
    UPDATE vc.voice_settings SET daily_chat_limit = 1 WHERE owner_user_id = 27202;
    IF FOUND THEN RAISE EXCEPTION 'settings USING allowed foreign update'; END IF;
END $$;
ROLLBACK;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.voice_clip) OR EXISTS (SELECT 1 FROM vc.voice_settings) THEN
        RAISE EXCEPTION 'missing owner context leaked voice data';
    END IF;
END $$;
COMMIT;

DELETE FROM vc.relationship WHERE owner_user_id = 27201 AND id = 27210;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.voice_clip WHERE owner_user_id = 27201)
       OR NOT EXISTS (SELECT 1 FROM vc.voice_settings WHERE owner_user_id = 27201) THEN
        RAISE EXCEPTION 'relationship deletion must cascade clips but retain owner settings';
    END IF;
END $$;
DELETE FROM vc.vc_user WHERE id IN (27201, 27202);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.voice_clip WHERE owner_user_id IN (27201, 27202))
       OR EXISTS (SELECT 1 FROM vc.voice_settings WHERE owner_user_id IN (27201, 27202)) THEN
        RAISE EXCEPTION 'account deletion did not cascade voice state';
    END IF;
END $$;
