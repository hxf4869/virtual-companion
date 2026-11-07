-- SX-7 source writers cannot cross owner or bypass raw-source identities.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(39001,'synthetic SX7 owner'),(39002,'synthetic SX7 foreign');
INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
 VALUES(39001,'sx7-rls-one','fixture','USER','ACTIVE','synthetic'),(39002,'sx7-rls-two','fixture','USER','ACTIVE','synthetic');
INSERT INTO vc.chat_authority VALUES(39001,'GO',2),(39002,'GO',2);
INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,group_ref,branch_root,header_cipher,metadata_cipher)
 VALUES(39001,'00000000-0000-4000-8000-000000039001','GROUP','synthetic','00000000-0000-4000-8000-000000039001','enc2:synthetic','enc2:synthetic');
BEGIN;
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 BEGIN PERFORM vc.sync_stored_source_jobs(39001,1,'{}'); RAISE EXCEPTION 'direct job helper accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
BEGIN;
SELECT vc.set_owner_context(39002,'sx7-foreign',encode(vc.hmac(convert_to('vc-owner-binding-v1|39002|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx7-foreign','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 BEGIN
  PERFORM vc.guard_st_evidence_write(39001,1,'st:synthetic');
  RAISE EXCEPTION 'foreign evidence write guard accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.publish_stored_chat_sources(39001,'00000000-0000-4000-8000-000000039001','[]','{}',false);
  RAISE EXCEPTION 'foreign source publication accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.copy_stored_chat_sources(39001,'00000000-0000-4000-8000-000000039001','00000000-0000-4000-8000-000000039001','[]');
  RAISE EXCEPTION 'foreign source fork accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.publish_stored_chat_sources(39002,'00000000-0000-4000-8000-000000039001','[]','{}',false);
  RAISE EXCEPTION 'foreign chat found using current owner';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
ROLLBACK;
UPDATE vc.chat_authority SET authority='FROZEN',epoch=3 WHERE owner_user_id=39001;
BEGIN;
SELECT vc.set_owner_context(39001,'sx7-frozen',encode(vc.hmac(convert_to('vc-owner-binding-v1|39001|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx7-frozen','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_worker;
DO $$ BEGIN
 BEGIN
  PERFORM vc.publish_stored_chat_sources(39001,'00000000-0000-4000-8000-000000039001','[]','{}',false);
  RAISE EXCEPTION 'frozen source publication accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'stored chat authority unavailable' THEN RAISE; END IF; END;
END $$;
ROLLBACK;
DELETE FROM vc.vc_user WHERE id IN(39001,39002);
DELETE FROM vc.identity_account WHERE id IN(39001,39002);
