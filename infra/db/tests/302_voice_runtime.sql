-- VO-2: revision CAS, trusted source binding, quotas, durable retries,
-- per-engine serialization, stale completion fencing and cascade cleanup.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27301,'voice runtime fixture A'),(27302,'voice runtime fixture B');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref) VALUES(27301,27310,'voice-fixture'),(27302,27311,'voice-fixture');
INSERT INTO vc.proactive_message(owner_user_id,id,relationship_id,trigger_key,kind,cluster_key,status,body) VALUES
 (27301,27320,27310,'share_day','share','share','READY','fixture-a'),
 (27301,27321,27310,'share_day','share','share','READY','fixture-a2'),
 (27302,27322,27311,'share_day','share','share','READY','fixture-b'),
 (27302,27323,27311,'share_day','share','share','READY','fixture-b2');
CREATE TEMP TABLE voice_runtime_ids(label text PRIMARY KEY,id bigint,started timestamptz);
GRANT ALL ON voice_runtime_ids TO vc_api;
CREATE TEMP TABLE voice_runtime_values(value jsonb);
INSERT INTO voice_runtime_values VALUES ('{"kokoroEnabled":true,"cosyVoiceEnabled":true,"asrEnabled":true,
 "kokoroTimeoutSeconds":60,"cosyVoiceTimeoutSeconds":300,"asrTimeoutSeconds":30,"dailyChatLimit":60,
 "dailyProactiveLimit":1,"voiceFrequency":"STANDARD","maxRecordingSeconds":60,
 "cosyVoiceInstructions":{"morning":"You are a helpful assistant.","night":"You are a helpful assistant.",
 "care":"You are a helpful assistant.","share":"You are a helpful assistant.","default":"You are a helpful assistant."},
 "kokoroMoodSpeeds":{"开心":1.05}}');
GRANT SELECT ON voice_runtime_values TO vc_api;

BEGIN;
SELECT vc.set_owner_context(27301,'voice-runtime-a',encode(vc.hmac(convert_to('vc-owner-binding-v1|27301|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-runtime-a','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_settings vc.voice_settings; v_clip vc.voice_clip; v_again vc.voice_clip;
BEGIN
 v_settings:=vc.save_voice_settings(27301,0,(SELECT value FROM voice_runtime_values));
 IF v_settings.revision<>1 OR v_settings.daily_proactive_limit<>1 THEN RAISE EXCEPTION 'settings write failed'; END IF;
 BEGIN
  PERFORM vc.save_voice_settings(27301,0,(SELECT value FROM voice_runtime_values));
  RAISE EXCEPTION 'stale revision accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'revision conflict (current 1)' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.save_voice_settings(27302,0,(SELECT value FROM voice_runtime_values));
  RAISE EXCEPTION 'foreign owner accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 PERFORM vc.put_relationship_voice(27301,27310,'{"speed":1.2,"voiceFrequency":"LOW","kokoroVoice":"zm_010"}');
 PERFORM vc.put_relationship_voice(27301,27310,'{}');
 IF NOT EXISTS(SELECT 1 FROM vc.relationship WHERE id=27310 AND voice_speed=1.2 AND voice_frequency='LOW' AND kokoro_voice='zm_010') THEN RAISE EXCEPTION 'omission reset voice settings'; END IF;
 PERFORM vc.put_relationship_voice(27301,27310,'{"voiceFrequency":null,"kokoroVoice":null}');
 IF NOT EXISTS(SELECT 1 FROM vc.relationship WHERE id=27310 AND voice_frequency IS NULL AND kokoro_voice IS NULL) THEN RAISE EXCEPTION 'null did not restore inheritance'; END IF;
 v_clip:=vc.enqueue_voice_clip(27301,27310,'proactive:27320','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','fixture-a');
 INSERT INTO voice_runtime_ids VALUES('a',v_clip.id,NULL);
 v_again:=vc.enqueue_voice_clip(27301,27310,'proactive:27320','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','fixture-a');
 IF v_again.id<>v_clip.id THEN RAISE EXCEPTION 'duplicate source created another job'; END IF;
 BEGIN
  PERFORM vc.enqueue_voice_clip(27301,27310,'proactive:27321','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','fixture-a2');
  RAISE EXCEPTION 'daily quota accepted another job';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'voice: rate limited' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.enqueue_voice_clip(27301,27310,'proactive:27322','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','fixture-b');
  RAISE EXCEPTION 'foreign source accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'voice: not found' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.enqueue_voice_clip(27301,27310,'proactive:27320','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','tampered');
  RAISE EXCEPTION 'untrusted synthesis text accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'voice: invalid text' THEN RAISE; END IF; END;
END $$;
COMMIT;

BEGIN;
SELECT vc.set_owner_context(27302,'voice-runtime-b',encode(vc.hmac(convert_to('vc-owner-binding-v1|27302|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-runtime-b','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_clip vc.voice_clip; BEGIN
 v_clip:=vc.enqueue_voice_clip(27302,27311,'proactive:27322','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','fixture-b');
 INSERT INTO voice_runtime_ids VALUES('b',v_clip.id,NULL);
 IF (SELECT count(*) FROM vc.voice_clip)<>1 THEN RAISE EXCEPTION 'owner saw another owner clip'; END IF;
END $$;
COMMIT;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_clip vc.voice_clip; BEGIN
 SELECT * INTO v_clip FROM vc.claim_voice_clip('kokoro');
 IF v_clip.owner_user_id<>27301 OR v_clip.status<>'running' OR v_clip.started_at IS NULL THEN RAISE EXCEPTION 'claim did not persist running state'; END IF;
 UPDATE voice_runtime_ids SET started=v_clip.started_at WHERE label='a';
 IF EXISTS(SELECT 1 FROM vc.claim_voice_clip('kokoro')) THEN RAISE EXCEPTION 'engine was concurrently claimed'; END IF;
END $$;
COMMIT;

BEGIN;
SELECT vc.set_owner_context(27301,'voice-runtime-finish',encode(vc.hmac(convert_to('vc-owner-binding-v1|27301|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-runtime-finish','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_id bigint; v_started timestamptz; BEGIN
 SELECT id,started INTO v_id,v_started FROM voice_runtime_ids WHERE label='a';
 IF vc.complete_voice_clip(27301,v_id,v_started-interval '1 second','ready','',1000,2,0) THEN RAISE EXCEPTION 'stale completion accepted'; END IF;
 IF NOT vc.complete_voice_clip(27301,v_id,v_started,'ready','',1000,2,0) THEN RAISE EXCEPTION 'valid completion rejected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.voice_clip WHERE id=v_id AND status='ready' AND object_key='27301/27310/'||v_id::text||'.wav') THEN RAISE EXCEPTION 'ready object missing'; END IF;
END $$;
COMMIT;

-- Simulate a crashed call by advancing only its fixture deadline.
SELECT * FROM vc.claim_voice_clip('kokoro') \gset ignored_
UPDATE vc.voice_clip SET available_at=clock_timestamp()-interval '1 second' WHERE owner_user_id=27302;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.claim_voice_clip('kokoro')) THEN RAISE EXCEPTION 'crashed synthesis was replayed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.voice_clip WHERE owner_user_id=27302 AND status='failed' AND error_kind='timeout') THEN RAISE EXCEPTION 'crash did not fall back to text'; END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(27302,'voice-runtime-retry',encode(vc.hmac(convert_to('vc-owner-binding-v1|27302|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-runtime-retry','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_clip vc.voice_clip; BEGIN
 v_clip:=vc.enqueue_voice_clip(27302,27311,'proactive:27323','proactive','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','fixture-b2');
 INSERT INTO voice_runtime_ids VALUES('retry',v_clip.id,NULL);
 SELECT * INTO v_clip FROM vc.claim_voice_clip('kokoro');
 IF NOT vc.complete_voice_clip(27302,v_clip.id,v_clip.started_at,'queued','',0,2,2) THEN RAISE EXCEPTION '429 retry was rejected'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.voice_clip WHERE id=v_clip.id AND retry_count=1 AND status='queued' AND available_at>clock_timestamp() AND started_at IS NULL) THEN RAISE EXCEPTION 'retry timing was not persisted'; END IF;
 IF EXISTS(SELECT 1 FROM vc.claim_voice_clip('kokoro')) THEN RAISE EXCEPTION 'retry ignored backoff'; END IF;
END $$;
COMMIT;
UPDATE vc.voice_clip SET retry_count=3,available_at=clock_timestamp()-interval '1 second' WHERE id=(SELECT id FROM voice_runtime_ids WHERE label='retry');
BEGIN;
SELECT vc.set_owner_context(27302,'voice-runtime-cap',encode(vc.hmac(convert_to('vc-owner-binding-v1|27302|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-runtime-cap','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE v_clip vc.voice_clip; BEGIN
 SELECT * INTO v_clip FROM vc.claim_voice_clip('kokoro');
 BEGIN
  PERFORM vc.complete_voice_clip(27302,v_clip.id,v_clip.started_at,'queued','',0,2,1);
  RAISE EXCEPTION 'fourth retry accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'voice: invalid retry' THEN RAISE; END IF; END;
 IF NOT vc.complete_voice_clip(27302,v_clip.id,v_clip.started_at,'failed','rate_limited',0,2,0) THEN RAISE EXCEPTION 'retry exhaustion failed to finish'; END IF;
END $$;
COMMIT;

DELETE FROM vc.proactive_message WHERE owner_user_id=27301 AND id=27320;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.voice_clip WHERE owner_user_id=27301) THEN RAISE EXCEPTION 'deleted source retained voice text/audio'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.list_voice_cleanup() q WHERE q.object_key='27301/27310/'||(SELECT id FROM voice_runtime_ids WHERE label='a')::text||'.wav') THEN RAISE EXCEPTION 'source deletion lost object cleanup pointer'; END IF;
END $$;
DELETE FROM vc.vc_user WHERE id IN(27301,27302);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.voice_object_cleanup WHERE owner_user_id=27302) THEN RAISE EXCEPTION 'owner cascade lost pending audio cleanup'; END IF;
END $$;
DELETE FROM vc.voice_object_cleanup WHERE owner_user_id IN(27301,27302);
