-- S0-15: refresh family registry, live session list/revoke, password change
-- and admin one-time reset. No IP, token, or device fingerprint is stored.
-- Refresh replay of a rotated token revokes the whole family. Password
-- recovery is never "sent" — there is no mail/SMS channel here.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.identity_refresh_token
    ADD COLUMN IF NOT EXISTS family_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE vc.identity_refresh_token
    ADD COLUMN IF NOT EXISTS client_label text;
ALTER TABLE vc.identity_refresh_token
    ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE vc.identity_refresh_token
    DROP CONSTRAINT IF EXISTS identity_refresh_token_client_label_check;
ALTER TABLE vc.identity_refresh_token
    ADD CONSTRAINT identity_refresh_token_client_label_check
        CHECK (client_label IS NULL OR client_label ~ '^[a-z0-9-]{1,32}$');

CREATE INDEX IF NOT EXISTS identity_refresh_token_account_live_idx
    ON vc.identity_refresh_token (account_id)
    WHERE revoked_at IS NULL;

ALTER TABLE vc.identity_account
    ADD COLUMN IF NOT EXISTS password_must_change boolean NOT NULL DEFAULT false;
ALTER TABLE vc.identity_account
    ADD COLUMN IF NOT EXISTS reauth_until timestamptz;

ALTER TABLE vc.identity_auth_event
    DROP CONSTRAINT IF EXISTS identity_auth_event_event_type_check;
ALTER TABLE vc.identity_auth_event
    ADD CONSTRAINT identity_auth_event_event_type_check
        CHECK (event_type IN (
            'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
            'ACCOUNT_CREATE', 'ACCOUNT_DISABLE', 'ACCOUNT_DELETE',
            'EMERGENCY_CONTACT_VIEW',
            'SESSION_REVOKE', 'SESSION_REVOKE_ALL', 'PASSWORD_CHANGE',
            'ADMIN_PASSWORD_RESET', 'ADMIN_REAUTH'));

DROP FUNCTION IF EXISTS vc.identity_authenticate(text);

CREATE FUNCTION vc.identity_authenticate(
    p_username text
)
    RETURNS TABLE(
        out_account_id bigint,
        out_role text,
        out_status text,
        out_password_hash text,
        out_password_must_change boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username text := lower(btrim(p_username));
BEGIN
    IF p_username IS NULL OR v_username = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT a.id, a.role, a.status, a.password_hash, a.password_must_change
          FROM vc.identity_account a
         WHERE a.username = v_username;
END;
$$;

DROP FUNCTION IF EXISTS vc.identity_refresh_token_issue(bigint, text, timestamptz);

CREATE FUNCTION vc.identity_refresh_token_issue(
    p_account_id   bigint,
    p_token_hash   text,
    p_expires_at   timestamptz,
    p_client_label text DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_label text;
BEGIN
    IF p_account_id IS NULL OR p_token_hash IS NULL OR btrim(p_token_hash) = ''
       OR p_expires_at IS NULL THEN
        RAISE EXCEPTION 'identity_refresh_token_issue: account_id, token_hash and expires_at are required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_account_id AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_refresh_token_issue: account is not active';
    END IF;
    v_label := NULL;
    IF p_client_label IS NOT NULL AND p_client_label ~ '^[a-z0-9-]{1,32}$' THEN
        v_label := p_client_label;
    END IF;
    INSERT INTO vc.identity_refresh_token(
            account_id, token_hash, expires_at, family_id, client_label, last_seen_at)
    VALUES (p_account_id, p_token_hash, p_expires_at, gen_random_uuid(), v_label, now())
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_refresh_token_rotate(
    p_old_token_hash text,
    p_new_token_hash text,
    p_new_expires_at timestamptz
)
    RETURNS TABLE(out_account_id bigint, out_role text, out_status text,
                  out_username text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_account_id bigint;
    v_family uuid;
    v_label text;
    v_revoked timestamptz;
    v_killed integer;
BEGIN
    IF p_old_token_hash IS NULL OR btrim(p_old_token_hash) = ''
       OR p_new_token_hash IS NULL OR btrim(p_new_token_hash) = ''
       OR p_new_expires_at IS NULL THEN
        RAISE EXCEPTION 'identity_refresh_token_rotate: token hashes and expires_at are required';
    END IF;
    SELECT t.account_id, t.family_id, t.client_label INTO v_account_id, v_family, v_label
      FROM vc.identity_refresh_token t
      JOIN vc.identity_account a ON a.id = t.account_id
     WHERE t.token_hash = p_old_token_hash
       AND t.revoked_at IS NULL
       AND t.expires_at > now()
       AND a.status = 'ACTIVE'
     FOR UPDATE OF t;
    IF FOUND THEN
        UPDATE vc.identity_refresh_token
           SET revoked_at = now()
         WHERE token_hash = p_old_token_hash
           AND revoked_at IS NULL
           AND expires_at > now();
        IF NOT FOUND THEN
            RETURN;
        END IF;
        INSERT INTO vc.identity_refresh_token(
                account_id, token_hash, expires_at, family_id, client_label, last_seen_at)
        VALUES (v_account_id, p_new_token_hash, p_new_expires_at, v_family, v_label, now());
        RETURN QUERY
            SELECT a.id, a.role, a.status, a.username
              FROM vc.identity_account a
             WHERE a.id = v_account_id;
        RETURN;
    END IF;
    -- Replay of a rotated (revoked) token: kill the live family, bump epoch.
    SELECT t.account_id, t.family_id, t.revoked_at
      INTO v_account_id, v_family, v_revoked
      FROM vc.identity_refresh_token t
     WHERE t.token_hash = p_old_token_hash;
    -- Delayed replay of a stolen rotated token kills the family. A concurrent
    -- rotate loser (same hash, revoked moments ago) must not kill the winner.
    IF FOUND AND v_revoked IS NOT NULL AND v_family IS NOT NULL
       AND v_revoked < clock_timestamp() - interval '5 seconds' THEN
        UPDATE vc.identity_refresh_token
           SET revoked_at = now()
         WHERE family_id = v_family
           AND revoked_at IS NULL;
        GET DIAGNOSTICS v_killed = ROW_COUNT;
        IF v_killed > 0 THEN
            UPDATE vc.identity_account
               SET session_epoch = session_epoch + 1
             WHERE id = v_account_id;
            INSERT INTO vc.identity_auth_event(event_type, account_id, username)
            SELECT 'SESSION_REVOKE_ALL', a.id, a.username
              FROM vc.identity_account a
             WHERE a.id = v_account_id;
        END IF;
    END IF;
    RETURN;
END;
$$;

CREATE FUNCTION vc.identity_list_sessions(
    p_account_id   bigint,
    p_current_hash text
)
    RETURNS TABLE(
        out_id bigint,
        out_family_id uuid,
        out_client_label text,
        out_created_at timestamptz,
        out_last_seen_at timestamptz,
        out_expires_at timestamptz,
        out_current boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_list_sessions: account_id is required';
    END IF;
    RETURN QUERY
    SELECT t.id, t.family_id, t.client_label, t.created_at, t.last_seen_at, t.expires_at,
           (p_current_hash IS NOT NULL AND t.token_hash = p_current_hash)
      FROM vc.identity_refresh_token t
     WHERE t.account_id = p_account_id
       AND t.revoked_at IS NULL
       AND t.expires_at > now()
     ORDER BY t.last_seen_at DESC, t.id DESC;
END;
$$;

CREATE FUNCTION vc.identity_revoke_session(
    p_account_id bigint,
    p_session_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_family uuid;
    v_killed integer;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 OR p_session_id IS NULL OR p_session_id <= 0 THEN
        RAISE EXCEPTION 'identity_revoke_session: account_id and session_id are required';
    END IF;
    SELECT family_id INTO v_family
      FROM vc.identity_refresh_token
     WHERE id = p_session_id AND account_id = p_account_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE family_id = v_family
       AND account_id = p_account_id
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_killed = ROW_COUNT;
    IF v_killed > 0 THEN
        UPDATE vc.identity_account
           SET session_epoch = session_epoch + 1
         WHERE id = p_account_id;
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        SELECT 'SESSION_REVOKE', a.id, a.username
          FROM vc.identity_account a
         WHERE a.id = p_account_id;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.identity_revoke_all_sessions(p_account_id bigint)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_killed integer;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_revoke_all_sessions: account_id is required';
    END IF;
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE account_id = p_account_id
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_killed = ROW_COUNT;
    IF v_killed > 0 THEN
        UPDATE vc.identity_account
           SET session_epoch = session_epoch + 1
         WHERE id = p_account_id;
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        SELECT 'SESSION_REVOKE_ALL', a.id, a.username
          FROM vc.identity_account a
         WHERE a.id = p_account_id;
    END IF;
    RETURN v_killed;
END;
$$;

CREATE FUNCTION vc.identity_change_password(
    p_account_id bigint,
    p_password_hash text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0
       OR p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_change_password: account_id and password_hash are required';
    END IF;
    UPDATE vc.identity_account
       SET password_hash = p_password_hash,
           password_must_change = false,
           session_epoch = session_epoch + 1
     WHERE id = p_account_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE account_id = p_account_id AND revoked_at IS NULL;
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    SELECT 'PASSWORD_CHANGE', a.id, a.username
      FROM vc.identity_account a
     WHERE a.id = p_account_id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.identity_admin_reset_password(
    p_acting_account_id bigint,
    p_target_account_id bigint,
    p_password_hash text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_reauth timestamptz;
    v_status text;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0
       OR p_target_account_id IS NULL OR p_target_account_id <= 0
       OR p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_admin_reset_password: arguments are required';
    END IF;
    SELECT a.role, a.reauth_until INTO v_role, v_reauth
      FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS DISTINCT FROM 'ADMIN' THEN
        RAISE EXCEPTION 'identity_admin_reset_password: ADMIN re-auth is required';
    END IF;
    IF v_reauth IS NULL OR v_reauth < now() THEN
        RAISE EXCEPTION 'identity_admin_reset_password: ADMIN re-auth is required';
    END IF;
    SELECT status INTO v_status
      FROM vc.identity_account
     WHERE id = p_target_account_id;
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_account
       SET password_hash = p_password_hash,
           password_must_change = true,
           session_epoch = session_epoch + 1
     WHERE id = p_target_account_id;
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE account_id = p_target_account_id AND revoked_at IS NULL;
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    SELECT 'ADMIN_PASSWORD_RESET', a.id, a.username
      FROM vc.identity_account a
     WHERE a.id = p_target_account_id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.identity_record_reauth(p_account_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_record_reauth: account_id is required';
    END IF;
    UPDATE vc.identity_account
       SET reauth_until = now() + interval '15 minutes'
     WHERE id = p_account_id AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    SELECT 'ADMIN_REAUTH', a.id, a.username
      FROM vc.identity_account a
     WHERE a.id = p_account_id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.identity_reauth_valid(p_account_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_until timestamptz;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RETURN FALSE;
    END IF;
    SELECT reauth_until INTO v_until
      FROM vc.identity_account
     WHERE id = p_account_id AND status = 'ACTIVE';
    RETURN v_until IS NOT NULL AND v_until >= now();
END;
$$;

REVOKE ALL ON FUNCTION vc.identity_authenticate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_refresh_token_issue(bigint, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_refresh_token_rotate(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_list_sessions(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_revoke_session(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_revoke_all_sessions(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_change_password(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_admin_reset_password(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_record_reauth(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_reauth_valid(bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.identity_authenticate(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_refresh_token_issue(bigint, text, timestamptz, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_refresh_token_rotate(text, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_list_sessions(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_revoke_session(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_revoke_all_sessions(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_change_password(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_admin_reset_password(bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_record_reauth(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_reauth_valid(bigint) TO vc_api;
