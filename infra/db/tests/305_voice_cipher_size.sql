\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27601,'voice cipher fixture');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref) VALUES(27601,27610,'voice cipher');
INSERT INTO vc.voice_clip(owner_user_id,id,relationship_id,purpose,engine,voice,params,text,status,object_key,duration_ms,generation_ms,ready_at)
 VALUES(27601,27620,27610,'preview','kokoro','zf_001','{"speed":1,"timeoutSeconds":60}','synthetic preview','ready','27601/27610/27620.wav',1000,1,clock_timestamp());
BEGIN;
SELECT vc.set_owner_context(27601,'voice-cipher',encode(vc.hmac(convert_to('vc-owner-binding-v1|27601|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|voice-cipher','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE full_cipher bigint:=4*((33554432::bigint+12+16+2)/3)+58; BEGIN
 PERFORM vc.record_voice_size(27601,27620,full_cipher);
 IF (SELECT storage_bytes FROM vc.voice_clip WHERE owner_user_id=27601 AND id=27620)<>full_cipher THEN
  RAISE EXCEPTION 'valid full-sized encrypted voice was not recorded';
 END IF;
 BEGIN
  PERFORM vc.record_voice_size(27601,27620,-1);
  RAISE EXCEPTION 'negative storage size accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
COMMIT;
