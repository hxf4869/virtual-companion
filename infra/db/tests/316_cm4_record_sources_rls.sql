-- CM4 overloads preserve the existing owner context and narrow EXECUTE grants.
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO vc.vc_user(id,display_name) VALUES(40001,'synthetic CM4 owner'),(40002,'synthetic CM4 foreign');
INSERT INTO vc.relationship(owner_user_id,id,persona_ref,active)
 VALUES(40001,40001,'synthetic-cm4',true),(40002,40002,'synthetic-cm4',true);
INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id,revision) VALUES(40001,40001,0);
INSERT INTO vc.memorycore_operation(owner_user_id,job_id,relationship_id,source_id,operation_id,scope,revision,state,proposal)
 VALUES(40001,40001,40001,40001,'synthetic-cm4-op','{}',0,'REVOKED','{"records":[]}');
DO $$
DECLARE sig text; proc record;
BEGIN
 FOREACH sig IN ARRAY ARRAY[
  'vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[],jsonb)',
  'vc.go_memorycore_cleaned(bigint,bigint,text[])'
 ] LOOP
  IF NOT has_function_privilege('vc_api',sig,'EXECUTE')
     OR NOT has_function_privilege('vc_worker',sig,'EXECUTE') THEN
   RAISE EXCEPTION 'CM4 runtime EXECUTE grant missing: %',sig;
  END IF;
  SELECT p.prosecdef,p.proconfig INTO STRICT proc FROM pg_proc p WHERE p.oid=sig::regprocedure;
  IF NOT proc.prosecdef OR NOT ('search_path=vc, pg_catalog'=ANY(proc.proconfig)) THEN
   RAISE EXCEPTION 'CM4 definer/search_path contract lost: %',sig;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid=sig::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN
   RAISE EXCEPTION 'CM4 PUBLIC EXECUTE permitted: %',sig;
  END IF;
 END LOOP;
 IF has_table_privilege('vc_api','vc.memory_evidence','INSERT')
    OR has_table_privilege('vc_worker','vc.memory_evidence','INSERT') THEN
  RAISE EXCEPTION 'CM4 opened direct evidence writes';
 END IF;
 -- Preserve the transition paths as independently callable overloads.
 IF NOT has_function_privilege('vc_worker','vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[])','EXECUTE')
    OR NOT has_function_privilege('vc_worker','vc.go_memorycore_cleaned(bigint,bigint)','EXECUTE') THEN
  RAISE EXCEPTION 'CM4 removed legacy overload privileges';
 END IF;
END $$;
SAVEPOINT owner_case;
SELECT vc.set_owner_context(40002,'cm4-foreign',encode(vc.hmac(convert_to('vc-owner-binding-v1|40002|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|cm4-foreign','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.memorycore_operation WHERE owner_user_id=40001)
    OR EXISTS(SELECT 1 FROM vc.memorycore_scope WHERE owner_user_id=40001) THEN
  RAISE EXCEPTION 'CM4 cross owner operation/scope visible';
 END IF;
 BEGIN
  PERFORM vc.go_publish_memorycore(40001,40001,'synthetic','synthetic','{"records":[]}'::jsonb,ARRAY['st:synthetic'],'{}'::jsonb);
  RAISE EXCEPTION 'CM4 cross owner publication accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM vc.go_memorycore_cleaned(40001,40001,ARRAY[]::text[]);
  RAISE EXCEPTION 'CM4 cross owner cleanup accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
 BEGIN
  UPDATE vc.memorycore_operation SET state='CLEANED' WHERE owner_user_id=40001 AND job_id=40001;
  RAISE EXCEPTION 'CM4 direct operation update permitted';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $$;
ROLLBACK TO SAVEPOINT owner_case;
RELEASE SAVEPOINT owner_case;
SAVEPOINT owner_case;
SELECT vc.set_owner_context(40002,'cm4-worker-foreign',encode(vc.hmac(convert_to('vc-owner-binding-v1|40002|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|cm4-worker-foreign','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_worker;
DO $$ BEGIN
 BEGIN
  PERFORM vc.go_publish_memorycore(40001,40001,'synthetic','synthetic','{"records":[]}'::jsonb,ARRAY['st:synthetic'],'{}'::jsonb);
  RAISE EXCEPTION 'CM4 worker cross owner publication accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM vc.go_memorycore_cleaned(40001,40001,ARRAY[]::text[]);
  RAISE EXCEPTION 'CM4 worker cross owner cleanup accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
END $$;
ROLLBACK TO SAVEPOINT owner_case;
RELEASE SAVEPOINT owner_case;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.memorycore_operation WHERE owner_user_id=40001 AND job_id=40001 AND state='REVOKED' AND proposal='{"records":[]}'::jsonb) THEN
  RAISE EXCEPTION 'CM4 foreign request changed owner data';
 END IF;
END $$;
ROLLBACK;
