-- MemoryCore deletion receipts are owner-bound and precede final Go deletion.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES(15101,'synthetic memory rights'),(15102,'synthetic other rights');
INSERT INTO vc.account_deletion_intent(account_id,username_digest,status) VALUES(15101,repeat('a',64),'REQUESTED'),(15102,repeat('b',64),'REQUESTED');
BEGIN;
SELECT vc.set_owner_context(15101,'rights',encode(vc.hmac(convert_to('vc-owner-binding-v1|15101|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|rights','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.require_memorycore_account_deletion_current();
DO $$ BEGIN
 IF vc.get_memorycore_account_deletion_current()<>'PENDING' THEN RAISE EXCEPTION 'engine deletion was not required'; END IF;
 BEGIN
  PERFORM 1 FROM vc.account_deletion_intent;
  RAISE EXCEPTION 'runtime read deletion intent directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
COMMIT;
RESET ROLE;
DO $$ BEGIN
 BEGIN
  DELETE FROM vc.vc_user WHERE id=15101;
  RAISE EXCEPTION 'Go account deleted before engine receipt';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'MemoryCore account cleanup is pending' THEN RAISE; END IF;
 END;
END $$;
BEGIN;
SELECT vc.set_owner_context(15102,'other-rights',encode(vc.hmac(convert_to('vc-owner-binding-v1|15102|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|other-rights','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.complete_memorycore_account_deletion_current();
DO $$ BEGIN
 IF vc.get_memorycore_account_deletion_current()<>'NOT_APPLICABLE' THEN RAISE EXCEPTION 'another owner receipt leaked'; END IF;
END $$;
COMMIT;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT memorycore_status FROM vc.account_deletion_intent WHERE account_id=15101)<>'PENDING' THEN RAISE EXCEPTION 'cross owner completed receipt'; END IF;
END $$;
BEGIN;
SELECT vc.set_owner_context(15101,'rights-complete',encode(vc.hmac(convert_to('vc-owner-binding-v1|15101|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|rights-complete','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.complete_memorycore_account_deletion_current();
SELECT vc.complete_memorycore_account_deletion_current();
DO $$ BEGIN
 IF vc.get_memorycore_account_deletion_current()<>'COMPLETED' THEN RAISE EXCEPTION 'same receipt not idempotent'; END IF;
END $$;
COMMIT;
RESET ROLE;
DELETE FROM vc.vc_user WHERE id=15101;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM vc.vc_user WHERE id=15102) THEN RAISE EXCEPTION 'other owner removed'; END IF;
END $$;
