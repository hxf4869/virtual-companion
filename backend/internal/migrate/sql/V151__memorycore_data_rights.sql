-- MemoryCore is an online data-rights domain. Keep its receipt with the existing
-- durable deletion intent, so Go deletion cannot precede external completion.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.account_deletion_intent ADD COLUMN memorycore_status text NOT NULL DEFAULT 'NOT_APPLICABLE'
 CHECK(memorycore_status IN ('NOT_APPLICABLE','PENDING','COMPLETED'));
CREATE FUNCTION vc.require_memorycore_account_deletion_current() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 UPDATE vc.account_deletion_intent SET memorycore_status='PENDING'
 WHERE account_id=vc.current_owner_id() AND status='REQUESTED' AND memorycore_status='NOT_APPLICABLE';
$$;
CREATE FUNCTION vc.get_memorycore_account_deletion_current() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT memorycore_status FROM vc.account_deletion_intent WHERE account_id=vc.current_owner_id();
$$;
CREATE FUNCTION vc.complete_memorycore_account_deletion_current() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 UPDATE vc.account_deletion_intent SET memorycore_status='COMPLETED'
 WHERE account_id=vc.current_owner_id() AND status='REQUESTED' AND memorycore_status='PENDING';
$$;
CREATE FUNCTION vc.requires_memorycore_account_cleanup_current() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM vc.memory_item WHERE owner_user_id=vc.current_owner_id() AND engine_record_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM vc.memorycore_operation WHERE owner_user_id=vc.current_owner_id());
$$;
CREATE FUNCTION vc.guard_memorycore_account_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM vc.account_deletion_intent WHERE account_id=OLD.id AND memorycore_status='PENDING')
 OR ((EXISTS(SELECT 1 FROM vc.memory_item WHERE owner_user_id=OLD.id AND engine_record_id IS NOT NULL)
 OR EXISTS(SELECT 1 FROM vc.memorycore_operation WHERE owner_user_id=OLD.id))
 AND NOT EXISTS(SELECT 1 FROM vc.account_deletion_intent WHERE account_id=OLD.id AND memorycore_status='COMPLETED')) THEN
   RAISE EXCEPTION 'MemoryCore account cleanup is pending';
 END IF;
 RETURN OLD;
END;
$$;
CREATE TRIGGER memorycore_cleanup_before_account_delete BEFORE DELETE ON vc.vc_user FOR EACH ROW EXECUTE FUNCTION vc.guard_memorycore_account_delete();
REVOKE ALL ON FUNCTION vc.require_memorycore_account_deletion_current(),vc.get_memorycore_account_deletion_current(),vc.complete_memorycore_account_deletion_current(),vc.requires_memorycore_account_cleanup_current(),vc.guard_memorycore_account_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.require_memorycore_account_deletion_current(),vc.get_memorycore_account_deletion_current(),vc.complete_memorycore_account_deletion_current(),vc.requires_memorycore_account_cleanup_current() TO vc_api,vc_worker;
