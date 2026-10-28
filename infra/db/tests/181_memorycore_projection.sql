\set ON_ERROR_STOP on
TRUNCATE vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id,display_name) VALUES(1,'alice'),(2,'bob');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES(1,14901,'synthetic',true),(2,14902,'synthetic',true);
INSERT INTO vc.memorycore_scope VALUES(1,14901,0),(2,14902,7);
BEGIN;
SELECT vc.set_owner_context(1,'engine',encode(vc.hmac(convert_to('vc-owner-binding-v1|1|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|engine','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF (SELECT count(*) FROM vc.memorycore_scope)<>1 THEN RAISE EXCEPTION 'engine scope isolation failed'; END IF;
 BEGIN
  INSERT INTO vc.memorycore_operation(owner_user_id,job_id,relationship_id,source_id,operation_id,scope,revision) VALUES(2,1,14902,1,'foreign','{}',0);
  RAISE EXCEPTION 'cross owner operation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF vc.enqueue_memory_extract(1,123) IS NOT NULL THEN RAISE EXCEPTION 'retired producer enqueued'; END IF;
 IF has_function_privilege('vc_api','vc.upsert_memory_embedding(bigint,bigint,text,text,integer,text,text)','EXECUTE') THEN RAISE EXCEPTION 'retired vector write permitted'; END IF;
END $$;
COMMIT;
