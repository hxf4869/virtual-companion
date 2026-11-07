-- SX-3: raw chat documents, receipts and source outbox share owner isolation.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(38701,'synthetic SX owner'),(38702,'synthetic SX foreign');
INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
 VALUES(38701,'sx-rls-one','fixture','USER','ACTIVE','synthetic'),(38702,'sx-rls-two','fixture','USER','ACTIVE','synthetic');
INSERT INTO vc.chat_authority VALUES(38701,'GO',2);
INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,group_ref,branch_root,header_cipher,metadata_cipher)
 VALUES(38701,'00000000-0000-4000-8000-000000038701','GROUP','synthetic','00000000-0000-4000-8000-000000038701','enc2:synthetic','enc2:synthetic');
BEGIN;
INSERT INTO vc.stored_message(owner_user_id,chat_id,message_id,position,selected_candidate_id,data_cipher,initial_digest)
 VALUES(38701,'00000000-0000-4000-8000-000000038701','00000000-0000-4000-8000-000000038711',1,'00000000-0000-4000-8000-000000038721','enc2:synthetic','\x01');
INSERT INTO vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id,ordinal,data_cipher,initial_digest)
 VALUES(38701,'00000000-0000-4000-8000-000000038701','00000000-0000-4000-8000-000000038711','00000000-0000-4000-8000-000000038721',0,'enc2:synthetic','\x01');
COMMIT;
INSERT INTO vc.chat_receipt(owner_user_id,resource,request_id,request_digest,operation_id,chat_id,result_revision,status,result_cipher)
 VALUES(38701,'POST /api/v1/chats','00000000-0000-4000-8000-000000038731','\x01','00000000-0000-4000-8000-000000038741','00000000-0000-4000-8000-000000038701',1,201,'enc2:synthetic');
INSERT INTO vc.chat_change(owner_user_id,chat_id,revision,event) VALUES(38701,'00000000-0000-4000-8000-000000038701',1,'{}');

BEGIN;
SET LOCAL ROLE vc_api;
DO $$ DECLARE t text; n bigint; BEGIN
 FOREACH t IN ARRAY ARRAY['chat_authority','stored_chat','stored_message','stored_candidate','chat_receipt','chat_change'] LOOP
  EXECUTE format('SELECT count(*) FROM vc.%I',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'unbound chat rows visible: %',t; END IF;
 END LOOP;
END $$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(38702,'sx-foreign',encode(vc.hmac(convert_to('vc-owner-binding-v1|38702|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx-foreign','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE t text; n bigint; BEGIN
 FOREACH t IN ARRAY ARRAY['chat_authority','stored_chat','stored_message','stored_candidate','chat_receipt','chat_change'] LOOP
  EXECUTE format('SELECT count(*) FROM vc.%I WHERE owner_user_id=38701',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'foreign chat rows visible: %',t; END IF;
 END LOOP;
 BEGIN
  INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,group_ref,branch_root,header_cipher,metadata_cipher) VALUES(38701,'00000000-0000-4000-8000-000000038799','GROUP','synthetic','00000000-0000-4000-8000-000000038799','enc2:synthetic','enc2:synthetic');
  RAISE EXCEPTION 'foreign write accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM vc.insert_stored_chat(38701,'00000000-0000-4000-8000-000000038799','GROUP',NULL,NULL,NULL,'synthetic','00000000-0000-4000-8000-000000038799','','enc2:synthetic','enc2:synthetic');
  RAISE EXCEPTION 'foreign function write accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
 END;
 IF NOT EXISTS(SELECT 1 FROM vc.lock_chat_authority(38702,false) WHERE authority='ST' AND epoch=1) THEN RAISE EXCEPTION 'default authority switched'; END IF;
END $$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(38701,'sx-own',encode(vc.hmac(convert_to('vc-owner-binding-v1|38701|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx-own','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ DECLARE t text; n bigint; BEGIN
 FOREACH t IN ARRAY ARRAY['chat_authority','stored_chat','stored_message','stored_candidate','chat_receipt','chat_change'] LOOP
  EXECUTE format('SELECT count(*) FROM vc.%I WHERE owner_user_id=38701',t) INTO n;
  IF n<>1 THEN RAISE EXCEPTION 'own chat rows missing: %',t; END IF;
 END LOOP;
 BEGIN UPDATE vc.chat_authority SET authority='ST' WHERE owner_user_id=38701; RAISE EXCEPTION 'runtime changed authority';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM vc.wipe_all_chats(38701);
 IF NOT EXISTS(SELECT 1 FROM vc.chat_receipt WHERE owner_user_id=38701 AND result_cipher IS NULL) THEN RAISE EXCEPTION 'deletion retained receipt body'; END IF;
 IF EXISTS(SELECT 1 FROM vc.stored_message WHERE owner_user_id=38701) OR EXISTS(SELECT 1 FROM vc.stored_candidate WHERE owner_user_id=38701) THEN RAISE EXCEPTION 'delete failed to cascade'; END IF;
END $$;
ROLLBACK;
DELETE FROM vc.vc_user WHERE id IN (38701,38702);
