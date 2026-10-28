-- W08 management data is accessible only through owner-bound functions.
\set ON_ERROR_STOP on
TRUNCATE vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id,display_name) VALUES(1,'alice'),(2,'bob');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active) VALUES(1,15001,'synthetic',true),(2,15002,'synthetic',true);
INSERT INTO vc.memory_item(owner_user_id,id,relationship_id,scope,summary,status,engine_record_id,engine_version)
VALUES(1,15001,15001,'RELATIONSHIP','synthetic owner fact','ACCEPTED','owned-record',1),(2,15002,15002,'RELATIONSHIP','other fact','ACCEPTED','other-record',1);
INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id,revision) VALUES(1,15001,0),(2,15002,0);
BEGIN;
SELECT vc.set_owner_context(1,'mgmt',encode(vc.hmac(convert_to('vc-owner-binding-v1|1|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|mgmt','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE row jsonb; BEGIN
 row:=vc.memory_management_detail(1,15001);
 IF row->>'memoryId'<>'15001' OR row->>'version'<>'1' OR row->>'lifecycle'<>'ACTIVE' THEN RAISE EXCEPTION 'owned detail missing'; END IF;
 IF vc.memory_management_detail(1,15002) IS NOT NULL OR vc.memory_management_detail(2,15002) IS NOT NULL THEN RAISE EXCEPTION 'foreign detail disclosed'; END IF;
 IF EXISTS(SELECT 1 FROM vc.memory_management_list(1,15002,'','','','',0,30)) THEN RAISE EXCEPTION 'foreign relationship disclosed'; END IF;
 IF EXISTS(SELECT 1 FROM vc.memory_management_evidence(2,15002)) THEN RAISE EXCEPTION 'foreign evidence disclosed'; END IF;
 row:=vc.memory_correction_reserve(1,15001,2,'new fact','correct-stale');
 IF row->>'conflict'<>'true' THEN RAISE EXCEPTION 'stale version accepted'; END IF;
 BEGIN
  PERFORM vc.memory_forget_begin(2,15002);
  RAISE EXCEPTION 'foreign forget accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='foreign forget accepted' THEN RAISE; END IF; END;
 IF NOT vc.memory_forget_begin(1,15001) THEN RAISE EXCEPTION 'own forget failed'; END IF;
 row:=vc.memory_management_detail(1,15001);
 IF row->>'lifecycle'<>'FORGETTING' OR row->>'recallEligible'<>'false' OR row#>>'{cleanup,state}'<>'PENDING' THEN RAISE EXCEPTION 'forget failed to suppress'; END IF;
 PERFORM vc.memory_cleanup_finish(1,15001,'PARTIAL');
 IF vc.memory_management_detail(1,15001)#>>'{cleanup,state}'<>'PARTIAL' THEN RAISE EXCEPTION 'partial cleanup hidden'; END IF;
 PERFORM vc.memory_cleanup_finish(1,15001,'DONE');
 IF vc.memory_management_detail(1,15001)->>'lifecycle'<>'FORGOTTEN' THEN RAISE EXCEPTION 'cleanup completion missing'; END IF;
END $$;
COMMIT;
