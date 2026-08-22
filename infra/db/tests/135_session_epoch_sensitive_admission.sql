-- 135_session_epoch_sensitive_admission: S0-30 V84 — disable/logout bump
-- session epoch; access snapshot returns status+epoch; sensitive-route
-- admission is shared and fail-closed on owner mismatch; emergency-contact
-- is not a limited route.

\set ON_ERROR_STOP on

TRUNCATE vc.sensitive_route_admission, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_epoch integer;
    v_status text;
    v_admitted boolean;
    v_retry integer;
    v_n integer;
BEGIN
    SELECT vc.identity_admin_seed('root-se', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-se', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    SELECT out_status, out_session_epoch INTO v_status, v_epoch
      FROM vc.identity_access_snapshot(v_user);
    IF v_status IS DISTINCT FROM 'ACTIVE' OR v_epoch IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'fresh account epoch must be 1 ACTIVE, got % %', v_status, v_epoch;
    END IF;

    PERFORM vc.identity_account_disable(v_admin, v_user);
    SELECT out_status, out_session_epoch INTO v_status, v_epoch
      FROM vc.identity_access_snapshot(v_user);
    IF v_status IS DISTINCT FROM 'DISABLED' OR v_epoch IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'disable must bump epoch, got % %', v_status, v_epoch;
    END IF;
END $$;

INSERT INTO vc.identity_refresh_token(account_id, token_hash, expires_at)
SELECT id, 'hash-se-1', now() + interval '1 day'
  FROM vc.identity_account WHERE username = 'alice-se';

SELECT set_config('t.alice', (SELECT id FROM vc.identity_account WHERE username = 'alice-se')::text, false);

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.alice')::bigint,
    'n1',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.alice')
        || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_user bigint := current_setting('t.alice')::bigint;
    v_admitted boolean;
    v_retry integer;
    i integer;
BEGIN
    FOR i IN 1..5 LOOP
        SELECT out_admitted, out_retry_after INTO v_admitted, v_retry
          FROM vc.admit_sensitive_route(v_user, 'EXPORT', 3, 3600);
        IF i <= 3 AND v_admitted IS NOT TRUE THEN
            RAISE EXCEPTION 'export hit % should be admitted', i;
        END IF;
        IF i > 3 AND v_admitted IS NOT FALSE THEN
            RAISE EXCEPTION 'export hit % must 429, retry=%', i, v_retry;
        END IF;
    END LOOP;

    BEGIN
        PERFORM vc.admit_sensitive_route(v_user + 1, 'EXPORT', 3, 3600);
        RAISE EXCEPTION 'owner mismatch must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN
                RAISE;
            END IF;
    END;
END $$;
COMMIT;
RESET ROLE;
