-- Clearing an already-deleted object's pointer is cleanup, not new outbound
-- data. Keep every other export mutation behind the deletion-intent guard.
CREATE FUNCTION vc.guard_export_during_account_deletion()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.account_id = NEW.owner_user_id) THEN
        IF TG_OP = 'UPDATE' THEN
            IF NEW.object_key IS NULL AND NEW.object_bytes IS NULL
               AND (to_jsonb(NEW) - 'object_key' - 'object_bytes') =
                   (to_jsonb(OLD) - 'object_key' - 'object_bytes') THEN
                RETURN NEW;
            END IF;
        END IF;
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER export_request_deletion_intent_guard ON vc.export_request;
CREATE TRIGGER export_request_deletion_intent_guard
BEFORE INSERT OR UPDATE ON vc.export_request
FOR EACH ROW EXECUTE FUNCTION vc.guard_export_during_account_deletion();

REVOKE ALL ON FUNCTION vc.guard_export_during_account_deletion() FROM PUBLIC;
