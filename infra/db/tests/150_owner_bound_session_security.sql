-- 150_owner_bound_session_security: S0-15 runtime session/password functions
-- derive the actor from the HMAC-bound owner context; caller-supplied actor
-- variants are no longer executable by vc_api.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-owner-session', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'user-owner-session', '$2a$10$user.hash.placeholder',
        'USER', 'User') INTO v_user;
    PERFORM vc.identity_refresh_token_issue(
        v_admin, encode(sha256('admin-session'::bytea), 'hex'), now() + interval '7 days');
    PERFORM vc.identity_refresh_token_issue(
        v_user, encode(sha256('user-session'::bytea), 'hex'), now() + interval '7 days');
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.user', v_user::text, false);
END $$;

-- Missing trusted context fails closed even though vc_api can execute the wrapper.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        PERFORM * FROM vc.identity_list_current_sessions(NULL);
    EXCEPTION WHEN others THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'session list without owner context must fail closed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'owner-session-user',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|owner-session-user', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_count integer;
    v_session bigint;
    v_denied boolean := false;
BEGIN
    SELECT count(*), min(out_id) INTO v_count, v_session
      FROM vc.identity_list_current_sessions(
          encode(sha256('user-session'::bytea), 'hex'));
    IF v_count <> 1 OR v_session IS NULL THEN
        RAISE EXCEPTION 'owner wrapper must list exactly the user session';
    END IF;

    BEGIN
        PERFORM * FROM vc.identity_list_sessions(
            current_setting('t.admin')::bigint, NULL);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_api must not call actor-supplied session list';
    END IF;

    IF NOT vc.identity_revoke_current_session(v_session) THEN
        RAISE EXCEPTION 'owner wrapper must revoke its own session';
    END IF;
    SELECT count(*) INTO v_count FROM vc.identity_list_current_sessions(NULL);
    IF v_count <> 0 THEN
        RAISE EXCEPTION 'user session must be revoked';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM vc.identity_admin_reset_password_current(
            current_setting('t.admin')::bigint,
            '$2a$10$forbidden.hash.placeholder');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%ADMIN re-auth is required%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'USER context must not spoof ADMIN reset actor';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.admin')::bigint,
    'owner-session-admin',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.admin') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|owner-session-admin', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF NOT vc.identity_record_current_reauth()
       OR NOT vc.identity_current_reauth_valid() THEN
        RAISE EXCEPTION 'current ADMIN reauth wrappers must succeed';
    END IF;
    IF NOT vc.identity_admin_reset_password_current(
        current_setting('t.user')::bigint,
        '$2a$10$reset.hash.placeholderxxx') THEN
        RAISE EXCEPTION 'current ADMIN reset wrapper must succeed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF has_function_privilege(
        'vc_api', 'vc.identity_list_sessions(bigint, text)', 'EXECUTE')
       OR has_function_privilege(
        'vc_api', 'vc.identity_revoke_session(bigint, bigint)', 'EXECUTE')
       OR has_function_privilege(
        'vc_api', 'vc.identity_admin_reset_password(bigint, bigint, text)', 'EXECUTE')
       OR has_function_privilege(
        'vc_api', 'vc.identity_record_reauth(bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api retains an actor-supplied session/password function';
    END IF;
    IF NOT has_function_privilege(
        'vc_api', 'vc.identity_list_current_sessions(text)', 'EXECUTE')
       OR NOT has_function_privilege(
        'vc_api', 'vc.identity_admin_reset_password_current(bigint, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api lacks owner-bound session/password wrappers';
    END IF;
END $$;
