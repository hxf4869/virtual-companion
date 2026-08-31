-- 39_identity_accounts_sessions: the mature identity component (V14).
--
-- Platform-level identity accounts, server-state refresh sessions and the
-- authentication audit trail. Covers: the idempotent ADMIN bootstrap seed; the
-- credential fetch and BCrypt-hash storage (the hash is opaque here -- the
-- runtime password verifier does the comparison); LOGIN_SUCCESS / LOGIN_FAILURE /
-- LOGOUT / ACCOUNT_CREATE audit events; ADMIN-only account creation with no
-- public registration; refresh-token issue / rotate / logout with revoked,
-- expired, unknown and DISABLED-account tokens all failing closed; cross-account
-- logout never revoking another owner's session; and the runtime role having NO
-- direct DML on the identity tables (SECURITY DEFINER functions are the only
-- path, mirroring the V11-V13 memory pattern).

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

-- ===========================================================================
-- 1. ADMIN bootstrap seed (idempotent) + ownership-root linkage.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint; v_again bigint; n int;
BEGIN
    SELECT vc.identity_admin_seed('root-admin', '$2a$10$seed.hash.placeholder', 'Root Admin') INTO v_admin;
    IF v_admin <= 0 THEN RAISE EXCEPTION 'admin seed must return a positive id'; END IF;

    -- The account id IS the owner_user_id; a vc_user ownership root must exist.
    PERFORM 1 FROM vc.vc_user WHERE id = v_admin;
    IF NOT FOUND THEN RAISE EXCEPTION 'admin seed must create a vc_user ownership root'; END IF;

    -- Idempotent: a second seed must not create a duplicate or change the id.
    SELECT vc.identity_admin_seed('other-admin', '$2a$10$seed.hash.placeholder', 'Other') INTO v_again;
    IF v_again <> v_admin THEN RAISE EXCEPTION 'admin seed must be idempotent (same id), got % vs %', v_again, v_admin; END IF;

    SELECT count(*) INTO n FROM vc.identity_account WHERE role = 'ADMIN';
    IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one ADMIN after idempotent seed, got %', n; END IF;
END $$;

-- ===========================================================================
-- 2. Credential fetch: exact normalized match; unknown -> no rows (no
--    existence disclosure), and the password_hash is the opaque BCrypt hash.
-- ===========================================================================
DO $$
DECLARE
    v_id bigint; v_role text; v_status text; v_hash text; n int;
BEGIN
    SELECT out_account_id, out_role, out_status, out_password_hash
      INTO v_id, v_role, v_status, v_hash
      FROM vc.identity_authenticate('Root-Admin');  -- case-insensitive normalized lookup
    IF v_id IS NULL THEN RAISE EXCEPTION 'authenticate must find the seeded ADMIN by username'; END IF;
    IF v_role <> 'ADMIN' OR v_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'authenticate must return role/status, got %/%', v_role, v_status;
    END IF;
    IF v_hash IS DISTINCT FROM '$2a$10$seed.hash.placeholder' THEN
        RAISE EXCEPTION 'authenticate must return the stored BCrypt hash untouched';
    END IF;

    SELECT count(*) INTO n FROM vc.identity_authenticate('no-such-user');
    IF n <> 0 THEN RAISE EXCEPTION 'unknown username must yield no rows (existence hidden)'; END IF;

    SELECT count(*) INTO n FROM vc.identity_authenticate('');
    IF n <> 0 THEN RAISE EXCEPTION 'blank username must fail closed with no rows'; END IF;
END $$;

-- ===========================================================================
-- 3. Login audit: success and failure both recorded with the username; no
--    password or token columns exist to leak (schema-level guarantee).
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint; n int; v_type text;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'root-admin';

    PERFORM vc.identity_login_success(v_admin, 'root-admin');
    PERFORM vc.identity_login_failure('root-admin');
    PERFORM vc.identity_login_failure('unknown-user');

    SELECT count(*) INTO n FROM vc.identity_auth_event WHERE event_type = 'LOGIN_SUCCESS';
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 LOGIN_SUCCESS, got %', n; END IF;

    -- LOGIN_FAILURE binds the account id when the account exists, NULL otherwise.
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'LOGIN_FAILURE' AND username = 'root-admin' AND account_id = v_admin;
    IF n <> 1 THEN RAISE EXCEPTION 'LOGIN_FAILURE must record the known username+account'; END IF;
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'LOGIN_FAILURE' AND username = 'unknown-user' AND account_id IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'LOGIN_FAILURE for an unknown user must record NULL account'; END IF;
END $$;

-- ===========================================================================
-- 4. Account creation: ADMIN-only, no public registration.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint; v_user bigint; n int; v_role text;
    v_blocked boolean := false;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'root-admin';

    -- An ACTIVE ADMIN creates a USER account; vc_user root is created too.
    SELECT vc.identity_account_create(v_admin, 'Alice', '$2a$10$alice.hash.placeholder', 'USER', 'Alice User') INTO v_user;
    PERFORM 1 FROM vc.identity_account WHERE id = v_user AND username = 'alice' AND role = 'USER' AND status = 'ACTIVE';
    IF NOT FOUND THEN RAISE EXCEPTION 'created USER account must exist with normalized username'; END IF;
    PERFORM 1 FROM vc.vc_user WHERE id = v_user;
    IF NOT FOUND THEN RAISE EXCEPTION 'created account must have a vc_user ownership root'; END IF;

    -- Duplicate username is rejected (UNIQUE constraint) and never discloses a hint.
    BEGIN
        PERFORM vc.identity_account_create(v_admin, 'Alice', '$2a$10$x', 'USER', 'Dup Alice');
        RAISE EXCEPTION 'duplicate username must be rejected';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    -- A USER (non-admin) must not be able to create accounts.
    BEGIN
        PERFORM vc.identity_account_create(v_user, 'Bob', '$2a$10$x', 'USER', 'Bob');
        RAISE EXCEPTION 'a USER must not create accounts';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%a USER must not create accounts%' THEN
            RAISE;
        END IF;
        v_blocked := true;
    END;
    IF NOT v_blocked THEN RAISE EXCEPTION 'USER account creation must fail closed'; END IF;

    -- ACCOUNT_CREATE audit records the new account, never a credential.
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'ACCOUNT_CREATE' AND username = 'alice' AND account_id = v_user;
    IF n <> 1 THEN RAISE EXCEPTION 'expected an ACCOUNT_CREATE audit for the new user'; END IF;
END $$;

-- ===========================================================================
-- 5. Refresh sessions: issue, rotate, logout; revoked/expired/unknown and
--    DISABLED-account tokens all fail closed.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint; v_user bigint;
    v_new_hash text := encode(sha256('rt-new-1'::bytea), 'hex');
    v_old_hash text := encode(sha256('rt-old-1'::bytea), 'hex');
    v_expired_hash text := encode(sha256('rt-expired'::bytea), 'hex');
    v_unknown_hash text := encode(sha256('rt-unknown'::bytea), 'hex');
    v_out_id bigint; v_out_role text; v_out_status text; n int; v_ok boolean;
BEGIN
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'alice';

    -- Issue the first refresh session for the ACTIVE account.
    PERFORM vc.identity_refresh_token_issue(v_user, v_old_hash, now() + interval '7 days');
    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_old_hash AND revoked_at IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'issued refresh token must be unrevoked'; END IF;

    -- Rotate a valid token -> old revoked, new issued, account returned.
    SELECT count(*) INTO n FROM vc.identity_refresh_token_rotate(v_old_hash, v_new_hash, now() + interval '7 days');
    IF n <> 1 THEN RAISE EXCEPTION 'rotate of a valid token must return the account row'; END IF;
    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_old_hash AND revoked_at IS NOT NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'rotated old token must be revoked'; END IF;
    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_new_hash AND revoked_at IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'rotated new token must be unrevoked'; END IF;

    -- Rotating the now-revoked old token fails closed (no rows).
    SELECT count(*) INTO n FROM vc.identity_refresh_token_rotate(v_old_hash, encode(sha256('rt-reuse'::bytea), 'hex'), now() + interval '7 days');
    IF n <> 0 THEN RAISE EXCEPTION 'reuse of a revoked token must fail closed'; END IF;

    -- An expired token fails closed.
    PERFORM vc.identity_refresh_token_issue(v_user, v_expired_hash, now() - interval '1 second');
    SELECT count(*) INTO n FROM vc.identity_refresh_token_rotate(v_expired_hash, encode(sha256('rt-x'::bytea), 'hex'), now() + interval '7 days');
    IF n <> 0 THEN RAISE EXCEPTION 'expired token must fail closed'; END IF;

    -- An unknown token fails closed.
    SELECT count(*) INTO n FROM vc.identity_refresh_token_rotate(v_unknown_hash, encode(sha256('rt-u'::bytea), 'hex'), now() + interval '7 days');
    IF n <> 0 THEN RAISE EXCEPTION 'unknown token must fail closed'; END IF;

    -- Logout revokes the owned session; idempotent; cross-account never revokes.
    v_ok := vc.identity_logout(v_user, v_new_hash);
    IF NOT v_ok THEN RAISE EXCEPTION 'logout of an owned token must return true'; END IF;
    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_new_hash AND revoked_at IS NOT NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'logout must revoke the owned token'; END IF;
    v_ok := vc.identity_logout(v_user, v_new_hash);
    IF NOT v_ok THEN RAISE EXCEPTION 'logout must be idempotent (true on re-logout)'; END IF;

    -- A foreign owner's token is never revoked (fail closed).
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'root-admin';
    v_ok := vc.identity_logout(v_admin, v_new_hash);
    IF v_ok THEN RAISE EXCEPTION 'cross-account logout must fail closed'; END IF;

    -- LOGOUT audit recorded.
    SELECT count(*) INTO n FROM vc.identity_auth_event WHERE event_type = 'LOGOUT' AND account_id = v_user;
    IF n <> 1 THEN RAISE EXCEPTION 'expected one LOGOUT audit for the owned logout'; END IF;
END $$;

-- ===========================================================================
-- 6. DISABLED accounts: no refresh renewal (and the runtime rejects login by
--    status). A live token owned by a then-disabled account stops rotating.
-- ===========================================================================
DO $$
DECLARE
    v_user bigint;
    v_live_hash text := encode(sha256('rt-live'::bytea), 'hex');
    v_new_hash text := encode(sha256('rt-after-disable'::bytea), 'hex');
    n int;
BEGIN
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'alice';

    -- Issue while ACTIVE, then disable the account.
    PERFORM vc.identity_refresh_token_issue(v_user, v_live_hash, now() + interval '7 days');
    UPDATE vc.identity_account SET status = 'DISABLED' WHERE id = v_user;

    -- Issue for a DISABLED account fails closed.
    BEGIN
        PERFORM vc.identity_refresh_token_issue(v_user, v_new_hash, now() + interval '7 days');
        RAISE EXCEPTION 'issue for a DISABLED account must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%issue for a DISABLED account must fail closed%' THEN
            RAISE;
        END IF;
        NULL;
    END;

    -- A still-live token of the disabled account must NOT rotate.
    SELECT count(*) INTO n FROM vc.identity_refresh_token_rotate(v_live_hash, v_new_hash, now() + interval '7 days');
    IF n <> 0 THEN RAISE EXCEPTION 'rotate for a DISABLED account must fail closed'; END IF;
    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_live_hash AND revoked_at IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'a failed rotate must leave the live token untouched'; END IF;
END $$;

-- ===========================================================================
-- 7. Runtime roles have NO direct DML on the identity tables: SECURITY DEFINER
--    functions are the only path. Direct SELECT as vc_api fails closed.
-- ===========================================================================
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM count(*) FROM vc.identity_account;
        RAISE EXCEPTION 'vc_api must not read identity_account directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    BEGIN
        PERFORM count(*) FROM vc.identity_refresh_token;
        RAISE EXCEPTION 'vc_api must not read identity_refresh_token directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
RESET ROLE;
