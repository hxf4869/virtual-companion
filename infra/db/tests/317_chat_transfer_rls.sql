-- SX-8 transfer tables, least privilege, cleanup survival and frozen CAS.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(41001,'synthetic SX8'),(41002,'synthetic SX8 foreign');
INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name) VALUES
 (41001,'sx8-rls-one','fixture','USER','ACTIVE','synthetic'),(41002,'sx8-rls-two','fixture','USER','ACTIVE','synthetic');
INSERT INTO vc.chat_authority VALUES(41001,'GO',2),(41002,'GO',2);
INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,group_ref,branch_root,header_cipher,metadata_cipher)
 VALUES(41001,'00000000-0000-4000-8000-000000041001','GROUP','synthetic','00000000-0000-4000-8000-000000041001','enc2:synthetic','enc2:synthetic');
INSERT INTO vc.chat_transfer_object(transfer_id,owner_user_id,prefix) VALUES('00000000-0000-4000-8000-000000041001',41001,'chat-transfer/00000000-0000-4000-8000-000000041001/');
INSERT INTO vc.chat_import(owner_user_id,import_id,request_id,request_digest,authority_epoch,chat_id,input_cipher) VALUES(41001,'00000000-0000-4000-8000-000000041001','00000000-0000-4000-8000-000000041002','\x01',2,'00000000-0000-4000-8000-000000041002','enc2:synthetic');
BEGIN;
SET LOCAL ROLE vc_api;
DO $$ DECLARE t text;n bigint; BEGIN
 FOREACH t IN ARRAY ARRAY['chat_file_alias','chat_transfer_object','chat_import','chat_migration_run','chat_migration_checkpoint','chat_identity_tombstone'] LOOP
  EXECUTE format('SELECT count(*) FROM vc.%I',t) INTO n;
  IF n<>0 THEN RAISE EXCEPTION 'unbound transfer table leaked'; END IF;
  IF has_table_privilege('vc_api','vc.'||t,'INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'runtime direct transfer DML granted'; END IF;
 END LOOP;
 IF has_function_privilege('vc_api','vc.freeze_chat_migration(bigint,uuid,text,text,bigint)','EXECUTE') OR has_function_privilege('vc_api','vc.activate_chat_migration(bigint,uuid,bigint)','EXECUTE') THEN RAISE EXCEPTION 'API gained operator cutover'; END IF;
END $$;
ROLLBACK;
BEGIN;
SELECT vc.set_owner_context(41002,'sx8-foreign',encode(vc.hmac(convert_to('vc-owner-binding-v1|41002|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx8-foreign','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.chat_import) OR EXISTS(SELECT 1 FROM vc.chat_file_alias) OR EXISTS(SELECT 1 FROM vc.chat_transfer_object) THEN RAISE EXCEPTION 'foreign transfer table leaked'; END IF;
 BEGIN PERFORM vc.release_chat_transfer(41001,'00000000-0000-4000-8000-000000041001');RAISE EXCEPTION 'foreign cleanup release accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE;END IF;END;
 BEGIN PERFORM vc.claim_chat_import(41001,'00000000-0000-4000-8000-000000041001','00000000-0000-4000-8000-000000041003');RAISE EXCEPTION 'foreign claim accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE;END IF;END;
 BEGIN PERFORM vc.rename_chat_file(41001,'00000000-0000-4000-8000-000000041001','other.jsonl');RAISE EXCEPTION 'foreign alias rename accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE;END IF;END;
END $$;
ROLLBACK;
BEGIN;
SELECT vc.set_owner_context(41001,'sx8-owner',encode(vc.hmac(convert_to('vc-owner-binding-v1|41001|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx8-owner','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_worker;
SELECT vc.rename_chat_file(41001,'00000000-0000-4000-8000-000000041001','new.jsonl');
DO $$ DECLARE first boolean;second boolean; BEGIN
 first:=vc.claim_chat_import(41001,'00000000-0000-4000-8000-000000041001','00000000-0000-4000-8000-000000041003');
 second:=vc.claim_chat_import(41001,'00000000-0000-4000-8000-000000041001','00000000-0000-4000-8000-000000041004');
 IF NOT first OR second THEN RAISE EXCEPTION 'lease not exclusive';END IF;
 IF vc.finish_chat_import(41001,'00000000-0000-4000-8000-000000041001','00000000-0000-4000-8000-000000041004','DONE','enc2:synthetic') THEN RAISE EXCEPTION 'stale lease finished';END IF;
END $$;
SELECT vc.freeze_chat_migration(41001,'00000000-0000-4000-8000-000000041005','GO_TO_ST','GO',2);
DO $$ BEGIN
 BEGIN PERFORM vc.activate_chat_migration(41001,'00000000-0000-4000-8000-000000041005',3);RAISE EXCEPTION 'unverified migration activated';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'migration not verified' THEN RAISE;END IF;END;
 BEGIN PERFORM vc.freeze_chat_migration(41001,'00000000-0000-4000-8000-000000041006','GO_TO_ST','GO',2);RAISE EXCEPTION 'stale freeze CAS accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'migration authority conflict' THEN RAISE;END IF;END;
END $$;
COMMIT;
-- Deleting raw chat cannot release its old alias. Owner deletion can remove
-- compact request rows, but it cannot erase cleanup intents before object GC.
DELETE FROM vc.stored_chat WHERE owner_user_id=41001;
DO $$ BEGIN IF (SELECT count(*) FROM vc.chat_file_alias WHERE owner_user_id=41001)<>2 THEN RAISE EXCEPTION 'alias tombstones lost'; END IF; END $$;
DELETE FROM vc.vc_user WHERE id IN(41001,41002);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.chat_transfer_object WHERE owner_user_id=41001) THEN RAISE EXCEPTION 'owner deletion lost cleanup intent'; END IF;
 IF EXISTS(SELECT 1 FROM vc.chat_import WHERE owner_user_id=41001) THEN RAISE EXCEPTION 'owner deletion retained request'; END IF;
END $$;
DELETE FROM vc.chat_transfer_object WHERE owner_user_id=41001;
DELETE FROM vc.identity_account WHERE id IN(41001,41002);
