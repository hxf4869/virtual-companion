-- TASK-0034 V14: identity accounts, refresh tokens and authentication audit.
--
-- Mature self-hosted identity (GATE-IDENTITY-PROVIDER-SESSION APPROVED):
-- username+password accounts whose password_hash is a BCrypt hash, stateless
-- Bearer access tokens issued by the runtime, plus server-state refresh tokens
-- that can be revoked, and an audit trail for login success/failure, logout and
-- account creation.
--
-- identity_account is a PLATFORM-LEVEL management object (like
-- provider_deployment), NOT an owner-scoped business row: it carries no
-- owner_user_id and no RLS policy. Its id IS the owner_user_id it maps to --
-- the runtime derives owner_user_id from the authenticated account id
-- (user_id == owner_user_id, INV-TENANT-001), so the client never supplies an
-- owner identity and a development header can never become the identity source.
-- The account id references vc.vc_user(id) (the ownership root); account
-- creation inserts the vc_user row and the identity_account row atomically, so
-- every identity account is a real owner.
--
-- All access is funneled through SECURITY DEFINER functions (mirroring the
-- V11-V13 memory pattern): the runtime roles get NO direct DML on the identity
-- tables, so a compromised API session cannot read password hashes or tokens by
-- bypassing the functions, and cross-account operations fail closed or return
-- no rows (existence is never disclosed). Refresh tokens are stored ONLY as
-- sha256 hex hashes of the raw token; raw tokens never reach the database, and
-- plaintext passwords are held only in the runtime JVM for the Spring Security
-- BCrypt comparison (never stored, never logged, never sent to the database).

SET search_path TO vc, public;

-- sha256() (from the standard pgcrypto contrib module) is used by the runtime to
-- hash refresh tokens before storage; the test suite uses the same function to
-- build token hashes. This is PostgreSQL's built-in hash function, not a
-- self-written crypto primitive.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- identity_account_id_seq: account ids are also owner_user_ids and come from a
-- dedicated sequence starting high so they never collide with the small
-- manually-seeded vc_user ids used by the RLS test suite.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.identity_account_id_seq START WITH 1000000;

-- ---------------------------------------------------------------------------
-- identity_account: one row per internal account. Platform-level (no RLS). The
-- FK to vc_user guarantees an account always corresponds to a real ownership
-- root; deleting the root cascades to the account.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc.identity_account (
    id            bigint PRIMARY KEY,
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    role          text NOT NULL CHECK (role IN ('ADMIN', 'USER')),
    status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
    display_name  text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- identity_refresh_token: server-state refresh sessions. Only the sha256 hex
-- hash of the token is stored; the raw token is returned to the client once at
-- issue time. A row is live while revoked_at IS NULL AND expires_at > now().
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc.identity_refresh_token (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id bigint NOT NULL,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (account_id) REFERENCES vc.identity_account(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- identity_auth_event: append-only audit trail. Never stores a password, a raw
-- token or a token hash -- only the event, the account id and the username
-- (internal accounts; non-sensitive per the approved gate).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc.identity_auth_event (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type  text NOT NULL CHECK (event_type IN
                  ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'ACCOUNT_CREATE')),
    account_id  bigint,
    username    text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- identity_authenticate: fetch the stored account row for a login attempt.
-- Exact-match on the normalized (lower-cased) username. An unknown OR blank
-- username returns no rows (fail closed); the runtime equalizes timing with a
-- dummy BCrypt hash and records a LOGIN_FAILURE. Existence is never disclosed
-- beyond what the app needs to verify the presented credential.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_authenticate(
    p_username text
)
    RETURNS TABLE(out_account_id bigint, out_role text, out_status text,
                  out_password_hash text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_username text := lower(btrim(p_username));
BEGIN
    IF p_username IS NULL OR v_username = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT a.id, a.role, a.status, a.password_hash
          FROM vc.identity_account a
         WHERE a.username = v_username;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_login_success / identity_login_failure: audit login outcomes.
-- LOGIN_FAILURE stores the username (internal, non-sensitive) and the account
-- id when the account exists; neither event ever stores a password or token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_login_success(
    p_account_id bigint,
    p_username    text
)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_account_id IS NULL THEN
        RAISE EXCEPTION 'identity_login_success: account_id is required';
    END IF;
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('LOGIN_SUCCESS', p_account_id, lower(btrim(p_username)));
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_login_failure(
    p_username text
)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_username text := lower(btrim(p_username));
BEGIN
    IF p_username IS NULL OR v_username = '' THEN
        RAISE EXCEPTION 'identity_login_failure: username is required';
    END IF;
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('LOGIN_FAILURE',
            (SELECT id FROM vc.identity_account WHERE username = v_username),
            v_username);
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_refresh_token_issue: create the first refresh session for an ACTIVE
-- account (called after a successful login). Fail-closed for a foreign,
-- missing or DISABLED account (generic error, no disclosure).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_refresh_token_issue(
    p_account_id bigint,
    p_token_hash text,
    p_expires_at timestamptz
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_account_id IS NULL OR p_token_hash IS NULL OR btrim(p_token_hash) = ''
       OR p_expires_at IS NULL THEN
        RAISE EXCEPTION 'identity_refresh_token_issue: account_id, token_hash and expires_at are required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_account_id AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_refresh_token_issue: account is not active';
    END IF;
    INSERT INTO vc.identity_refresh_token(account_id, token_hash, expires_at)
    VALUES (p_account_id, p_token_hash, p_expires_at)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_refresh_token_rotate: atomic refresh-session renewal with a unique
-- single-use winner (P1-06). The old token must be unrevoked, unexpired and
-- owned by an ACTIVE account; it is then revoked and replaced by the new
-- session in one transaction. The token row is locked (SELECT ... FOR UPDATE
-- OF t) so two concurrent rotates of the same token serialize: the first
-- caller wins, the second re-checks the now-revoked row under the lock and
-- returns no rows (fail closed, nothing written). An unknown, revoked,
-- expired or DISABLED-account token returns no rows (all failure causes are
-- indistinguishable; existence and cause are never disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_refresh_token_rotate(
    p_old_token_hash text,
    p_new_token_hash text,
    p_new_expires_at timestamptz
)
    RETURNS TABLE(out_account_id bigint, out_role text, out_status text,
                  out_username text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_account_id bigint;
BEGIN
    IF p_old_token_hash IS NULL OR btrim(p_old_token_hash) = ''
       OR p_new_token_hash IS NULL OR btrim(p_new_token_hash) = ''
       OR p_new_expires_at IS NULL THEN
        RAISE EXCEPTION 'identity_refresh_token_rotate: token hashes and expires_at are required';
    END IF;
    -- The token row lock serializes concurrent rotates of the same token; the
    -- live-state re-check runs under the lock so only the first caller can
    -- ever see the old token as live.
    SELECT t.account_id INTO v_account_id
      FROM vc.identity_refresh_token t
      JOIN vc.identity_account a ON a.id = t.account_id
     WHERE t.token_hash = p_old_token_hash
       AND t.revoked_at IS NULL
       AND t.expires_at > now()
       AND a.status = 'ACTIVE'
     FOR UPDATE OF t;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    -- Conditional revoke as defense in depth: under the row lock the old
    -- token is still live, so this always matches exactly one row; a loser
    -- that somehow reached this point fails closed instead of inserting.
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE token_hash = p_old_token_hash
       AND revoked_at IS NULL
       AND expires_at > now();
    IF NOT FOUND THEN
        RETURN;
    END IF;
    INSERT INTO vc.identity_refresh_token(account_id, token_hash, expires_at)
    VALUES (v_account_id, p_new_token_hash, p_new_expires_at);
    RETURN QUERY
        SELECT a.id, a.role, a.status, a.username
          FROM vc.identity_account a
         WHERE a.id = v_account_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_logout: revoke one refresh session owned by the caller (idempotent).
-- A foreign or unknown token is never revoked and returns FALSE (fail closed);
-- an owned token returns TRUE whether or not it was already revoked. The LOGOUT
-- audit event is written only on the actual revocation transition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_logout(
    p_account_id bigint,
    p_token_hash text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_account_id IS NULL OR p_token_hash IS NULL OR btrim(p_token_hash) = '' THEN
        RAISE EXCEPTION 'identity_logout: account_id and token_hash are required';
    END IF;
    PERFORM 1
      FROM vc.identity_refresh_token
     WHERE account_id = p_account_id AND token_hash = p_token_hash;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE account_id = p_account_id
       AND token_hash = p_token_hash
       AND revoked_at IS NULL;
    IF FOUND THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        SELECT 'LOGOUT', a.id, a.username
          FROM vc.identity_account a
         WHERE a.id = p_account_id;
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_account_create: ADMIN-only account creation (no public registration).
-- Only an ACTIVE ADMIN can create; any other caller fails closed with a generic
-- error. The vc_user ownership root and the identity_account row are inserted
-- atomically; the new account starts ACTIVE. A duplicate username is rejected
-- by the UNIQUE constraint (the runtime maps it to a generic error).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_account_create(
    p_acting_account_id bigint,
    p_username          text,
    p_password_hash     text,
    p_role              text,
    p_display_name      text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_username    text := lower(btrim(p_username));
    v_role        text := upper(btrim(p_role));
    v_account_id  bigint;
BEGIN
    IF p_acting_account_id IS NULL THEN
        RAISE EXCEPTION 'identity_account_create: acting account is required';
    END IF;
    IF v_username = '' THEN
        RAISE EXCEPTION 'identity_account_create: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_account_create: password_hash is required';
    END IF;
    IF v_role NOT IN ('ADMIN', 'USER') THEN
        RAISE EXCEPTION 'identity_account_create: role must be ADMIN or USER';
    END IF;
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'identity_account_create: display_name is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_account_create: caller is not an active ADMIN';
    END IF;
    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, v_role, 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);
    RETURN v_account_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_admin_seed: platform-initialization path for the single ADMIN
-- account (called by the runtime at startup with credentials injected through
-- an approved channel; never committed to the repository). Idempotent: if any
-- ADMIN already exists the call is a no-op that returns the existing id, so a
-- restart never duplicates or overrides the bootstrap account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_admin_seed(
    p_username     text,
    p_password_hash text,
    p_display_name text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_username    text := lower(btrim(p_username));
    v_account_id  bigint;
BEGIN
    IF v_username = '' THEN
        RAISE EXCEPTION 'identity_admin_seed: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_admin_seed: password_hash is required';
    END IF;
    SELECT id INTO v_account_id
      FROM vc.identity_account
     WHERE role = 'ADMIN'
     ORDER BY id
     LIMIT 1;
    IF FOUND THEN
        RETURN v_account_id;
    END IF;
    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, 'ADMIN', 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);
    RETURN v_account_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the identity tables get NO grants to PUBLIC or the runtime roles
-- (REVOKE is defensive; CREATE TABLE grants nothing by default). Only the
-- SECURITY DEFINER functions above can touch them, and EXECUTE is granted to
-- vc_api alone -- the runtime application role. Everything else fails closed.
-- ---------------------------------------------------------------------------
REVOKE ALL ON vc.identity_account, vc.identity_refresh_token, vc.identity_auth_event FROM PUBLIC;
REVOKE ALL ON SEQUENCE vc.identity_account_id_seq FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION vc.identity_authenticate(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_login_success(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_login_failure(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_refresh_token_issue(bigint, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_refresh_token_rotate(text, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_logout(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_account_create(bigint, text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_admin_seed(text, text, text) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.identity_authenticate(text),
                vc.identity_login_success(bigint, text),
                vc.identity_login_failure(text),
                vc.identity_refresh_token_issue(bigint, text, timestamptz),
                vc.identity_refresh_token_rotate(text, text, timestamptz),
                vc.identity_logout(bigint, text),
                vc.identity_account_create(bigint, text, text, text, text),
                vc.identity_admin_seed(text, text, text)
    TO vc_api;
