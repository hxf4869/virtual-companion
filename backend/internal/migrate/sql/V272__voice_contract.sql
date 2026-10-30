-- VO-1: storage contract only. Engine clients, settings writes and queue
-- functions are introduced with VO-2; runtime roles retain read-only grants.
SET search_path TO vc, pg_catalog;

ALTER TABLE vc.relationship
    ADD COLUMN kokoro_voice text,
    ADD COLUMN cosy_voice text,
    ADD COLUMN voice_speed double precision NOT NULL DEFAULT 1.0,
    ADD COLUMN voice_frequency text,
    ADD COLUMN proactive_voice boolean NOT NULL DEFAULT true,
    ADD CONSTRAINT relationship_kokoro_voice CHECK (char_length(kokoro_voice) BETWEEN 1 AND 128),
    ADD CONSTRAINT relationship_cosy_voice CHECK (char_length(cosy_voice) BETWEEN 1 AND 128),
    ADD CONSTRAINT relationship_voice_speed CHECK (voice_speed BETWEEN 0.5 AND 2.0),
    ADD CONSTRAINT relationship_voice_frequency CHECK (voice_frequency IN ('OFF', 'LOW', 'STANDARD', 'HIGH'));

-- NULL voice names use the current gender and live engine voice list:
-- MALE -> zm_010, otherwise zf_001; CosyVoice defaults to default, with
-- Kokoro fallback when no suitable male CosyVoice voice exists.
-- NULL frequency inherits the owner's setting. No existing preferences or
-- get/list function result types change during this contract-only rollout.

CREATE TABLE vc.voice_settings (
    owner_user_id bigint PRIMARY KEY REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    kokoro_enabled boolean NOT NULL DEFAULT true,
    cosy_voice_enabled boolean NOT NULL DEFAULT true,
    asr_enabled boolean NOT NULL DEFAULT true,
    kokoro_timeout_seconds integer NOT NULL DEFAULT 60 CHECK (kokoro_timeout_seconds >= 1),
    cosy_voice_timeout_seconds integer NOT NULL DEFAULT 300 CHECK (cosy_voice_timeout_seconds >= 1),
    asr_timeout_seconds integer NOT NULL DEFAULT 30 CHECK (asr_timeout_seconds >= 1),
    daily_chat_limit integer NOT NULL DEFAULT 60 CHECK (daily_chat_limit >= 0),
    daily_proactive_limit integer NOT NULL DEFAULT 8 CHECK (daily_proactive_limit >= 0),
    voice_frequency text NOT NULL DEFAULT 'STANDARD' CHECK (voice_frequency IN ('LOW', 'STANDARD', 'HIGH')),
    cosy_voice_instructions jsonb NOT NULL DEFAULT '{
        "morning": "You are a helpful assistant. 请用刚睡醒、有点慵懒又温柔的语气说。",
        "night": "You are a helpful assistant. 请轻声、温柔、放慢一点地说。",
        "care": "You are a helpful assistant. 请温柔关切地说。",
        "share": "You are a helpful assistant. 请开心、轻快地说。",
        "default": "You are a helpful assistant."
    }'::jsonb CHECK (jsonb_typeof(cosy_voice_instructions) = 'object'),
    kokoro_mood_speeds jsonb NOT NULL DEFAULT '{"开心":1.05,"得意":1.05,"懒洋洋":0.92,"有点累":0.92,"困":0.92}'::jsonb
        CHECK (jsonb_typeof(kokoro_mood_speeds) = 'object'),
    max_recording_seconds integer NOT NULL DEFAULT 60 CHECK (max_recording_seconds BETWEEN 1 AND 60),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE SEQUENCE vc.voice_clip_id_seq AS bigint;
CREATE TABLE vc.voice_clip (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.voice_clip_id_seq'),
    relationship_id bigint NOT NULL,
    message_ref text,
    purpose text NOT NULL CHECK (purpose IN ('chat', 'proactive', 'preview')),
    engine text NOT NULL CHECK (engine IN ('kokoro', 'cosyvoice')),
    voice text NOT NULL CHECK (char_length(voice) BETWEEN 1 AND 128),
    params jsonb NOT NULL DEFAULT '{"speed":1.0}'::jsonb CHECK (jsonb_typeof(params) = 'object'),
    text text NOT NULL CHECK (char_length(btrim(text)) BETWEEN 1 AND 4000),
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'ready', 'failed', 'expired')),
    error_kind text CHECK (error_kind IN ('bad_request', 'rate_limited', 'upstream_error', 'timeout', 'unavailable', 'storage_error')),
    object_key text,
    duration_ms integer CHECK (duration_ms > 0),
    generation_ms integer CHECK (generation_ms >= 0),
    retry_count smallint NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 3),
    available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    ready_at timestamptz,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE,
    UNIQUE (owner_user_id, relationship_id, purpose, message_ref),
    CONSTRAINT voice_clip_message_ref CHECK (
        (purpose = 'preview' AND message_ref IS NULL)
        OR (purpose <> 'preview' AND message_ref IS NOT NULL AND char_length(btrim(message_ref)) BETWEEN 1 AND 512)),
    CONSTRAINT voice_clip_object_key CHECK (
        object_key IS NULL OR object_key = owner_user_id::text || '/' || relationship_id::text || '/' || id::text || '.wav'),
    CONSTRAINT voice_clip_ready CHECK (
        status <> 'ready' OR (object_key IS NOT NULL AND duration_ms IS NOT NULL
                             AND generation_ms IS NOT NULL AND ready_at IS NOT NULL)),
    CONSTRAINT voice_clip_error CHECK ((status = 'failed') = (error_kind IS NOT NULL))
);

-- Persist retry timing and enforce one running job per TTS engine across
-- owners/processes. Two engines imply at most two simultaneous TTS jobs.
CREATE INDEX voice_clip_queue ON vc.voice_clip(engine, purpose, available_at, created_at, id)
    WHERE status = 'queued';
CREATE UNIQUE INDEX voice_clip_engine_running ON vc.voice_clip(engine) WHERE status = 'running';

ALTER TABLE vc.voice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.voice_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.voice_clip ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.voice_clip FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.voice_settings FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.voice_clip FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
REVOKE ALL ON vc.voice_settings, vc.voice_clip, vc.voice_clip_id_seq FROM PUBLIC;
GRANT SELECT ON vc.voice_settings, vc.voice_clip TO vc_api, vc_worker;
GRANT USAGE, SELECT ON SEQUENCE vc.voice_clip_id_seq TO vc_api, vc_worker;
