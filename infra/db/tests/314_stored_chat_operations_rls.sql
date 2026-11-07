-- SX-5: new run/inbox receipts and controlled writers remain owner-scoped.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(38801,'synthetic SX5 owner'),(38802,'synthetic SX5 foreign');
INSERT INTO vc.identity_account(id,username,password_hash,role,status,display_name)
 VALUES(38801,'sx5-rls-one','fixture','USER','ACTIVE','synthetic'),(38802,'sx5-rls-two','fixture','USER','ACTIVE','synthetic');
INSERT INTO vc.chat_authority VALUES(38801,'GO',2),(38802,'GO',2);
INSERT INTO vc.stored_chat(owner_user_id,chat_id,kind,group_ref,branch_root,header_cipher,metadata_cipher)
 VALUES(38801,'00000000-0000-4000-8000-000000038801','GROUP','synthetic','00000000-0000-4000-8000-000000038801','enc2:synthetic','enc2:synthetic');
BEGIN;
INSERT INTO vc.stored_message(owner_user_id,chat_id,message_id,position,selected_candidate_id,data_cipher,initial_digest)
 VALUES(38801,'00000000-0000-4000-8000-000000038801','00000000-0000-4000-8000-000000038811',1,'00000000-0000-4000-8000-000000038821','enc2:synthetic','\x01');
INSERT INTO vc.stored_candidate(owner_user_id,chat_id,message_id,candidate_id,ordinal,data_cipher,initial_digest)
 VALUES(38801,'00000000-0000-4000-8000-000000038801','00000000-0000-4000-8000-000000038811','00000000-0000-4000-8000-000000038821',0,'enc2:synthetic','\x01');
COMMIT;
INSERT INTO vc.chat_generation_run(owner_user_id,chat_id,run_id,request_id,state,fence)
 VALUES(38801,'00000000-0000-4000-8000-000000038801','00000000-0000-4000-8000-000000038831','00000000-0000-4000-8000-000000038841','active','{}');
INSERT INTO vc.stored_chat_inbox(owner_user_id,chat_id,event_id,message_id)
 VALUES(38801,'00000000-0000-4000-8000-000000038801','synthetic-sx5-event','00000000-0000-4000-8000-000000038811');

BEGIN;
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.chat_generation_run) OR EXISTS(SELECT 1 FROM vc.stored_chat_inbox) THEN
  RAISE EXCEPTION 'unbound SX5 rows visible';
 END IF;
 BEGIN PERFORM vc.prune_stored_chat_runs(); RAISE EXCEPTION 'api role executed global cleanup';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(38802,'sx5-foreign',encode(vc.hmac(convert_to('vc-owner-binding-v1|38802|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx5-foreign','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.chat_generation_run WHERE owner_user_id=38801) OR EXISTS(SELECT 1 FROM vc.stored_chat_inbox WHERE owner_user_id=38801) THEN
  RAISE EXCEPTION 'foreign SX5 rows visible';
 END IF;
 BEGIN
  PERFORM vc.finish_stored_chat_run(38801,'00000000-0000-4000-8000-000000038801','00000000-0000-4000-8000-000000038831','settled');
  RAISE EXCEPTION 'foreign run committed';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.update_stored_message(38801,'00000000-0000-4000-8000-000000038801','00000000-0000-4000-8000-000000038811',1,2,
   '00000000-0000-4000-8000-000000038821','enc2:synthetic',2,false,true,true,false);
  RAISE EXCEPTION 'foreign message edited';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 BEGIN
  PERFORM vc.shift_stored_chat_positions(38801,'00000000-0000-4000-8000-000000038801',1,1);
  RAISE EXCEPTION 'foreign insert shifted positions';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF; END;
 PERFORM vc.shift_stored_chat_positions(38802,'00000000-0000-4000-8000-000000038801',1,1);
 IF vc.finish_stored_chat_run(38802,'00000000-0000-4000-8000-000000038801','00000000-0000-4000-8000-000000038831','settled') THEN
  RAISE EXCEPTION 'foreign run matched another owner';
 END IF;
END $$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(38801,'sx5-own',encode(vc.hmac(convert_to('vc-owner-binding-v1|38801|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|sx5-own','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF (SELECT count(*) FROM vc.chat_generation_run)<>1 OR (SELECT count(*) FROM vc.stored_chat_inbox)<>1 THEN
  RAISE EXCEPTION 'own SX5 rows missing';
 END IF;
 BEGIN UPDATE vc.chat_generation_run SET state='settled'; RAISE EXCEPTION 'direct run mutation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM vc.stored_chat_inbox; RAISE EXCEPTION 'direct inbox receipt deletion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT position FROM vc.stored_message WHERE message_id='00000000-0000-4000-8000-000000038811')<>1 THEN
  RAISE EXCEPTION 'foreign insert changed position';
 END IF;
 PERFORM vc.shift_stored_chat_positions(38801,'00000000-0000-4000-8000-000000038801',1,2);
 IF (SELECT position FROM vc.stored_message WHERE message_id='00000000-0000-4000-8000-000000038811')<>3 THEN
  RAISE EXCEPTION 'own insert did not shift position';
 END IF;
 PERFORM vc.wipe_all_chats(38801);
 IF EXISTS(SELECT 1 FROM vc.chat_generation_run) OR EXISTS(SELECT 1 FROM vc.stored_chat_inbox) THEN
  RAISE EXCEPTION 'wipe retained run or inbox rights';
 END IF;
END $$;
ROLLBACK;
DELETE FROM vc.vc_user WHERE id IN(38801,38802);
