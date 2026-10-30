-- VO-5: owner-isolated, immutable selection and explicit fast-engine preference.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(27401,'proactive voice fixture A'),(27402,'proactive voice fixture B');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref) VALUES(27401,27410,'voice'),(27402,27411,'voice');
INSERT INTO vc.proactive_message(owner_user_id,id,relationship_id,trigger_key,kind,cluster_key,status,body)
 VALUES(27401,27420,27410,'good_morning','check_in','greeting','READY','synthetic'),(27402,27421,27411,'good_morning','check_in','greeting','READY','synthetic');
BEGIN;
SELECT vc.set_owner_context(27401,'proactive-voice',encode(vc.hmac(convert_to('vc-owner-binding-v1|27401|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|proactive-voice','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 PERFORM vc.select_proactive_voice(27401,27420,true);
 PERFORM vc.select_proactive_voice(27401,27420,false);
 IF NOT EXISTS(SELECT 1 FROM vc.proactive_message WHERE id=27420 AND voice_selected) THEN RAISE EXCEPTION 'selection was redrawn'; END IF;
 IF EXISTS(SELECT 1 FROM vc.proactive_message WHERE id=27421) THEN RAISE EXCEPTION 'foreign selection visible'; END IF;
 BEGIN
  PERFORM vc.select_proactive_voice(27402,27421,true);
  RAISE EXCEPTION 'foreign selection accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 PERFORM vc.put_relationship_voice(27401,27410,'{"proactiveEngine":"kokoro"}');
 IF NOT EXISTS(SELECT 1 FROM vc.get_relationship(27401,27410) WHERE out_proactive_engine='kokoro') THEN RAISE EXCEPTION 'engine preference unreadable'; END IF;
 PERFORM vc.put_relationship_voice(27401,27410,'{"proactiveEngine":null}');
 IF NOT EXISTS(SELECT 1 FROM vc.list_relationships(27401) WHERE out_id=27410 AND out_proactive_engine IS NULL) THEN RAISE EXCEPTION 'engine inheritance not reset'; END IF;
END $$;
COMMIT;
