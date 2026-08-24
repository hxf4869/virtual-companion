-- 155_shared_rate_and_concurrency_limits: S0-30 shared anonymous source rate
-- limit plus owner-bound generation/SSE concurrent leases and opaque release.

\set ON_ERROR_STOP on

TRUNCATE vc.shared_auth_source_admission, vc.sensitive_route_lease,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;

DO $$
DECLARE v_admin bigint; v_user bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-shared-limit', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'user-shared-limit', '$2a$10$user.hash.placeholder',
        'USER', 'User') INTO v_user;
    PERFORM set_config('t.user', v_user::text, false);
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_admitted boolean; v_retry integer;
BEGIN
    SELECT out_admitted, out_retry_after INTO v_admitted, v_retry
      FROM vc.admit_shared_auth_source(repeat('a', 64), 'LOGIN', 2, 60);
    IF NOT v_admitted OR v_retry < 1 THEN RAISE EXCEPTION 'first shared login denied'; END IF;
    SELECT out_admitted INTO v_admitted
      FROM vc.admit_shared_auth_source(repeat('a', 64), 'LOGIN', 2, 60);
    IF NOT v_admitted THEN RAISE EXCEPTION 'second shared login denied'; END IF;
    SELECT out_admitted, out_retry_after INTO v_admitted, v_retry
      FROM vc.admit_shared_auth_source(repeat('a', 64), 'LOGIN', 2, 60);
    IF v_admitted OR v_retry < 1 THEN RAISE EXCEPTION 'third shared login must be limited'; END IF;
    SELECT out_admitted INTO v_admitted
      FROM vc.admit_shared_auth_source(repeat('a', 64), 'REFRESH', 1, 60);
    IF NOT v_admitted THEN RAISE EXCEPTION 'LOGIN and REFRESH windows must be independent'; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'shared-lease',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|shared-lease', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE l1 uuid; l2 uuid; l3 uuid; admitted boolean; retry integer;
BEGIN
    SELECT out_lease_id, out_admitted INTO l1, admitted
      FROM vc.acquire_sensitive_route_lease(
          current_setting('t.user')::bigint, 'SSE', 2, 130);
    IF NOT admitted OR l1 IS NULL THEN RAISE EXCEPTION 'first lease denied'; END IF;
    SELECT out_lease_id, out_admitted INTO l2, admitted
      FROM vc.acquire_sensitive_route_lease(
          current_setting('t.user')::bigint, 'SSE', 2, 130);
    IF NOT admitted OR l2 IS NULL OR l2 = l1 THEN RAISE EXCEPTION 'second lease denied'; END IF;
    SELECT out_lease_id, out_admitted, out_retry_after INTO l3, admitted, retry
      FROM vc.acquire_sensitive_route_lease(
          current_setting('t.user')::bigint, 'SSE', 2, 130);
    IF admitted OR l3 IS NOT NULL OR retry < 1 THEN
        RAISE EXCEPTION 'third concurrent lease must be limited';
    END IF;
    PERFORM set_config('t.lease1', l1::text, false);
    PERFORM set_config('t.lease2', l2::text, false);
END $$;
COMMIT;
RESET ROLE;

-- Async completion has no owner GUC; opaque lease+owner match is sufficient.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE admitted boolean; l3 uuid;
BEGIN
    IF vc.release_sensitive_route_lease(
        current_setting('t.user')::bigint, current_setting('t.lease1')::uuid) IS NOT TRUE THEN
        RAISE EXCEPTION 'async lease release failed';
    END IF;
    IF vc.release_sensitive_route_lease(
        current_setting('t.user')::bigint + 1, current_setting('t.lease2')::uuid) THEN
        RAISE EXCEPTION 'wrong owner must not release lease';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'shared-lease-reacquire',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|shared-lease-reacquire', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE admitted boolean;
BEGIN
    SELECT out_admitted INTO admitted FROM vc.acquire_sensitive_route_lease(
        current_setting('t.user')::bigint, 'SSE', 2, 130);
    IF NOT admitted THEN RAISE EXCEPTION 'released capacity was not reusable'; END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF has_table_privilege('vc_api', 'vc.shared_auth_source_admission', 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('vc_api', 'vc.sensitive_route_lease', 'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'runtime role must not directly access shared limiter tables';
    END IF;
END $$;
