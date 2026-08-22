-- 131_identity_account_status: S0-04 V80 — owner-scoped account status
-- for the generation admission gate. Covers: ACTIVE self-read; foreign id
-- fail-closed; vc_worker has no EXECUTE.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account
         CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-adm', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-adm', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-adm', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;
    PERFORM set_config('adm.a', v_alice::text, false);
    PERFORM set_config('adm.b', v_bob::text, false);
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('adm.a')::bigint,
    'n1',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('adm.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint := current_setting('adm.a')::bigint;
    v_bob   bigint := current_setting('adm.b')::bigint;
    v_status text;
BEGIN
    v_status := vc.identity_account_status(v_alice);
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'self status must be ACTIVE, got %', v_status;
    END IF;
    BEGIN
        PERFORM vc.identity_account_status(v_bob);
        RAISE EXCEPTION 'foreign account status must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%must match server-trusted context%'
               AND SQLERRM NOT LIKE '%account not found%' THEN
                RAISE;
            END IF;
    END;
END $$;
RESET ROLE;

DO $$
BEGIN
    IF has_function_privilege(
            'vc_worker',
            'vc.identity_account_status(bigint)',
            'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must not execute identity_account_status';
    END IF;
END $$;
