-- Password changes and opaque-session revocation are one owner-bound database
-- operation. If either write fails, PostgreSQL rolls the complete statement
-- back so a caller cannot observe a changed password with live old sessions.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.identity_change_current_password(p_password_hash text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint;
    v_changed boolean;
BEGIN
    v_owner_id := vc.current_owner_id();
    v_changed := vc.identity_change_password(v_owner_id, p_password_hash);
    IF NOT v_changed THEN
        RETURN FALSE;
    END IF;

    PERFORM vc.identity_opaque_session_revoke_all(v_owner_id);
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION vc.identity_change_current_password(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_change_current_password(text) TO vc_api;
