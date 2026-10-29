-- The service read of the owner rerank switch must be the caller's owner.
-- vc_api cannot pass another account id on a connection bound to someone else.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.go_service_resolve_owner_memory_rerank(p_owner bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE
    v_enabled boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_owner IS NULL OR p_owner <= 0 OR NOT EXISTS (
        SELECT 1 FROM vc.identity_account WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    SELECT enabled INTO v_enabled FROM vc.owner_memory_rerank WHERE owner_user_id = p_owner;
    RETURN COALESCE(v_enabled, true);
END;
$$;
