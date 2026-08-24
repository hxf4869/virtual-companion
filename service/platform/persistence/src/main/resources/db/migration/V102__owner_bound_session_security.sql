-- S0-15 review fix: authenticated session/password operations derive the actor
-- from the HMAC-bound owner context. Runtime vc_api can no longer spoof an
-- account id when listing/revoking sessions, changing a password or recording
-- ADMIN re-auth. Login/refresh token issue/rotate remain token-bound and are not
-- owner-context operations.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.identity_list_current_sessions(p_current_hash text)
    RETURNS TABLE(
        out_id bigint,
        out_family_id uuid,
        out_client_label text,
        out_created_at timestamptz,
        out_last_seen_at timestamptz,
        out_expires_at timestamptz,
        out_current boolean)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT * FROM vc.identity_list_sessions(vc.current_owner_id(), p_current_hash)
$$;

CREATE FUNCTION vc.identity_revoke_current_session(p_session_id bigint)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_revoke_session(vc.current_owner_id(), p_session_id)
$$;

CREATE FUNCTION vc.identity_revoke_all_current_sessions()
    RETURNS integer
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_revoke_all_sessions(vc.current_owner_id())
$$;

CREATE FUNCTION vc.identity_change_current_password(p_password_hash text)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_change_password(vc.current_owner_id(), p_password_hash)
$$;

CREATE FUNCTION vc.identity_admin_reset_password_current(
    p_target_account_id bigint,
    p_password_hash text)
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_admin_reset_password(
        vc.current_owner_id(), p_target_account_id, p_password_hash)
$$;

CREATE FUNCTION vc.identity_record_current_reauth()
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_record_reauth(vc.current_owner_id())
$$;

CREATE FUNCTION vc.identity_current_reauth_valid()
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_reauth_valid(vc.current_owner_id())
$$;

-- Remove the caller-supplied actor forms from the runtime role. They remain
-- owner-only implementation details so migrations/tests can verify the core.
REVOKE EXECUTE ON FUNCTION vc.identity_list_sessions(bigint, text) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.identity_revoke_session(bigint, bigint) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.identity_revoke_all_sessions(bigint) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.identity_change_password(bigint, text) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.identity_admin_reset_password(bigint, bigint, text) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.identity_record_reauth(bigint) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.identity_reauth_valid(bigint) FROM vc_api;

REVOKE ALL ON FUNCTION vc.identity_list_current_sessions(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_revoke_current_session(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_revoke_all_current_sessions() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_change_current_password(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_admin_reset_password_current(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_record_current_reauth() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_current_reauth_valid() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.identity_list_current_sessions(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_revoke_current_session(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_revoke_all_current_sessions() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_change_current_password(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_admin_reset_password_current(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_record_current_reauth() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_current_reauth_valid() TO vc_api;
