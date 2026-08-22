-- 142_list_ops_cases: S0-14-D V91 — operator list is kind-scoped and never
-- returns an internal_note column.

\set ON_ERROR_STOP on

TRUNCATE vc.ops_case_event, vc.ops_case, vc.report_request, vc.safety_event,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_rev bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-list', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-list', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;
    SELECT vc.identity_account_create(
        v_admin, 'rev-list', '$2a$10$rev.hash.placeholder', 'SAFETY_REVIEWER', 'Rev') INTO v_rev;
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.alice', v_user::text, false);
    PERFORM set_config('t.rev', v_rev::text, false);
END $$;

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
    v_admin bigint := current_setting('t.admin')::bigint;
    v_user bigint := current_setting('t.alice')::bigint;
    v_rev bigint := current_setting('t.rev')::bigint;
    v_report bigint;
    v_safety bigint;
    v_n integer;
    v_kind text;
BEGIN
    v_report := vc.create_report(v_user, NULL, 'OTHER', 'list');
    v_safety := vc.record_safety_event(v_user, NULL, 'INPUT', 'R3_HIGH', 'rule-list');
    PERFORM vc.open_ops_case(v_admin, 'REPORT', v_user, v_report, 'P2');
    PERFORM vc.open_ops_case(v_admin, 'SAFETY', v_user, v_safety, 'P1');

    SELECT count(*) INTO v_n FROM vc.list_ops_cases(v_admin, NULL, 50);
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'admin list must see both kinds, got %', v_n;
    END IF;

    SELECT count(*) INTO v_n FROM vc.list_ops_cases(v_rev, NULL, 50);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'SAFETY_REVIEWER list must see SAFETY only, got %', v_n;
    END IF;
    SELECT out_kind INTO v_kind FROM vc.list_ops_cases(v_rev, NULL, 50);
    IF v_kind IS DISTINCT FROM 'SAFETY' THEN
        RAISE EXCEPTION 'reviewer row must be SAFETY, got %', v_kind;
    END IF;

    BEGIN
        PERFORM vc.list_ops_cases(v_user, NULL, 50);
        RAISE EXCEPTION 'USER must not list cases';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%not an active operator%' THEN
                RAISE;
            END IF;
    END;
END $$;
COMMIT;
RESET ROLE;
