-- V94 review-fix (S0-15): surface password_must_change through the durable
-- access snapshot so the runtime enforces the admin-reset "must change on
-- first use" gate instead of leaving the flag decorative. Redefinition only:
-- same signature shape plus one out column, same SECURITY DEFINER posture,
-- same grants (vc_api executes it on every Bearer request via S0-30).

DROP FUNCTION IF EXISTS vc.identity_access_snapshot(bigint);

CREATE FUNCTION vc.identity_access_snapshot(p_account_id bigint)
    RETURNS TABLE(out_status text, out_session_epoch integer, out_role text,
                  out_password_must_change boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_access_snapshot: account_id is required';
    END IF;
    RETURN QUERY
    SELECT a.status, a.session_epoch, a.role, a.password_must_change
      FROM vc.identity_account a
     WHERE a.id = p_account_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.identity_access_snapshot(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_access_snapshot(bigint) TO vc_api;
