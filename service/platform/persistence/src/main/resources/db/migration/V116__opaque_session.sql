-- G9 / redesign §13.1: additive opaque session table for the Go runtime.
-- Java continues to own identity_refresh_token until Phase 5. Go stores only
-- the SHA-256 hex of the session token plus account, created, expiry, revoked
-- and reauth timestamps. Runtime roles have no direct table DML.

SET search_path TO vc, pg_catalog;

CREATE TABLE IF NOT EXISTS vc.identity_opaque_session (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id bigint NOT NULL,
    token_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    reauth_at  timestamptz,
    FOREIGN KEY (account_id) REFERENCES vc.identity_account(id) ON DELETE CASCADE,
    CONSTRAINT identity_opaque_session_hash_unique UNIQUE (token_hash),
    CONSTRAINT identity_opaque_session_hash_shape
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT identity_opaque_session_expiry
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS identity_opaque_session_account_live_idx
    ON vc.identity_opaque_session (account_id)
    WHERE revoked_at IS NULL;

REVOKE ALL ON TABLE vc.identity_opaque_session FROM PUBLIC;

CREATE FUNCTION vc.identity_opaque_session_issue(
    p_account_id bigint,
    p_token_hash text,
    p_expires_at timestamptz
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0
       OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
       OR p_expires_at IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION 'identity_opaque_session_issue: account, hash and future expiry are required';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = p_account_id AND status = 'ACTIVE'
    ) THEN
        RAISE EXCEPTION 'identity_opaque_session_issue: account is not active';
    END IF;
    INSERT INTO vc.identity_opaque_session(account_id, token_hash, expires_at)
    VALUES (p_account_id, p_token_hash, p_expires_at)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.identity_opaque_session_lookup(p_token_hash text)
    RETURNS TABLE(
        out_session_id bigint,
        out_account_id bigint,
        out_role text,
        out_username text,
        out_status text,
        out_password_must_change boolean,
        out_created_at timestamptz,
        out_expires_at timestamptz,
        out_reauth_at timestamptz
    )
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT s.id, a.id, a.role, a.username, a.status, a.password_must_change,
               s.created_at, s.expires_at, s.reauth_at
          FROM vc.identity_opaque_session s
          JOIN vc.identity_account a ON a.id = s.account_id
         WHERE s.token_hash = p_token_hash
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND a.status = 'ACTIVE';
END;
$$;

CREATE FUNCTION vc.identity_opaque_session_list(p_account_id bigint)
    RETURNS TABLE(
        out_session_id bigint,
        out_created_at timestamptz,
        out_expires_at timestamptz,
        out_reauth_at timestamptz
    )
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT s.id, s.created_at, s.expires_at, s.reauth_at
          FROM vc.identity_opaque_session s
         WHERE s.account_id = p_account_id
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
         ORDER BY s.created_at DESC, s.id DESC;
END;
$$;

CREATE FUNCTION vc.identity_opaque_session_revoke(
    p_account_id bigint,
    p_session_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    n int;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0
       OR p_session_id IS NULL OR p_session_id <= 0 THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_opaque_session
       SET revoked_at = now()
     WHERE id = p_session_id
       AND account_id = p_account_id
       AND revoked_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

CREATE FUNCTION vc.identity_opaque_session_revoke_hash(p_token_hash text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    n int;
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_opaque_session
       SET revoked_at = now()
     WHERE token_hash = p_token_hash
       AND revoked_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

CREATE FUNCTION vc.identity_opaque_session_revoke_all(p_account_id bigint)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    n int;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RETURN 0;
    END IF;
    UPDATE vc.identity_opaque_session
       SET revoked_at = now()
     WHERE account_id = p_account_id
       AND revoked_at IS NULL;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END;
$$;

CREATE FUNCTION vc.identity_opaque_session_record_reauth(
    p_account_id bigint,
    p_session_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    n int;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0
       OR p_session_id IS NULL OR p_session_id <= 0 THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_opaque_session
       SET reauth_at = now()
     WHERE id = p_session_id
       AND account_id = p_account_id
       AND revoked_at IS NULL
       AND expires_at > now();
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

REVOKE ALL ON FUNCTION vc.identity_opaque_session_issue(bigint, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_opaque_session_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_opaque_session_list(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_opaque_session_revoke(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_opaque_session_revoke_hash(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_opaque_session_revoke_all(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_opaque_session_record_reauth(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_issue(bigint, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_lookup(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_list(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_revoke(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_revoke_hash(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_revoke_all(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_opaque_session_record_reauth(bigint, bigint) TO vc_api;
