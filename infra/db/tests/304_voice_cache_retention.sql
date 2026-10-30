\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27501,'voice cache fixture');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref) VALUES(27501,27510,'voice cache');
BEGIN;
SELECT vc.set_owner_context(27501,'voice-cache',encode(vc.hmac(convert_to('vc-owner-binding-v1|27501|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-cache','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE a vc.voice_clip; b vc.voice_clip; BEGIN
 a:=vc.enqueue_voice_clip(27501,27510,NULL,'preview','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','synthetic preview');
 b:=vc.enqueue_voice_clip(27501,27510,NULL,'preview','kokoro','zf_001','{"speed":1,"timeoutSeconds":30}','synthetic preview');
 IF a.id<>b.id THEN RAISE EXCEPTION 'same preview enqueued twice'; END IF;
 b:=vc.enqueue_voice_clip(27501,27510,NULL,'preview','kokoro','zf_001','{"speed":1.1,"timeoutSeconds":60}','synthetic preview');
 IF a.id=b.id THEN RAISE EXCEPTION 'different speed reused audio'; END IF;
END $$;
COMMIT;
UPDATE vc.voice_clip SET status='ready',object_key=owner_user_id::text||'/'||relationship_id::text||'/'||id::text||'.wav',
 duration_ms=1000,generation_ms=1,ready_at=clock_timestamp(),created_at=clock_timestamp()-interval '25 hours'
 WHERE owner_user_id=27501;
INSERT INTO vc.voice_clip(owner_user_id,id,relationship_id,message_ref,purpose,engine,voice,params,text,status,object_key,duration_ms,generation_ms,ready_at,created_at)
 VALUES(27501,27590,27510,'synthetic-retained','chat','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','retained source','ready','27501/27510/27590.wav',1000,1,clock_timestamp(),clock_timestamp()-interval '25 hours');
BEGIN;
SET LOCAL ROLE vc_api;
SELECT vc.expire_voice_clips();
COMMIT;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.voice_clip WHERE owner_user_id=27501 AND purpose='preview') THEN RAISE EXCEPTION 'preview cache not expired'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.voice_clip WHERE owner_user_id=27501 AND id=27590) THEN RAISE EXCEPTION 'source-owned ready speech expired by age'; END IF;
 IF (SELECT count(*) FROM vc.voice_object_cleanup WHERE owner_user_id=27501)<>2 THEN RAISE EXCEPTION 'expired audio cleanup pointers lost'; END IF;
END $$;
