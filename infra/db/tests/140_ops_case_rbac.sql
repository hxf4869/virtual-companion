-- 140_ops_case_rbac: S0-14-B V89 — SAFETY_REVIEWER sees SAFETY only;
-- PRIVACY_OPERATOR sees REPORT/AGE_APPEAL; OPS_VIEWER cannot read
-- internal_note; BODY_ACCESS is audited.

\set ON_ERROR_STOP on

TRUNCATE vc.ops_case_event, vc.ops_case, vc.safety_event, vc.report_request,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_reviewer bigint;
    v_privacy bigint;
    v_viewer bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-rbac', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-rbac', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;
    SELECT vc.identity_account_create(
        v_admin, 'rev-rbac', '$2a$10$rev.hash.placeholder', 'SAFETY_REVIEWER', 'Rev') INTO v_reviewer;
    SELECT vc.identity_account_create(
        v_admin, 'priv-rbac', '$2a$10$priv.hash.placeholder', 'PRIVACY_OPERATOR', 'Priv') INTO v_privacy;
    SELECT vc.identity_account_create(
        v_admin, 'view-rbac', '$2a$10$view.hash.placeholder', 'OPS_VIEWER', 'View') INTO v_viewer;
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.alice', v_user::text, false);
    PERFORM set_config('t.rev', v_reviewer::text, false);
    PERFORM set_config('t.priv', v_privacy::text, false);
    PERFORM set_config('t.view', v_viewer::text, false);
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
    v_priv bigint := current_setting('t.priv')::bigint;
    v_view bigint := current_setting('t.view')::bigint;
    v_report bigint;
    v_safety bigint;
    v_report_case bigint;
    v_safety_case bigint;
    v_n integer;
BEGIN
    v_report := vc.create_report(v_user, NULL, 'PRIVACY_OR_DATA', 'rbac');
    v_safety := vc.record_safety_event(v_user, NULL, 'INPUT', 'R3_HIGH', 'rule-rbac');

    SELECT out_id INTO v_report_case
      FROM vc.open_ops_case(v_admin, 'REPORT', v_user, v_report, 'P1');
    SELECT out_id INTO v_safety_case
      FROM vc.open_ops_case(v_admin, 'SAFETY', v_user, v_safety, 'P1');

    PERFORM vc.ops_case_snapshot(v_rev, v_safety_case);

    BEGIN
        PERFORM vc.ops_case_snapshot(v_rev, v_report_case);
        RAISE EXCEPTION 'SAFETY_REVIEWER must not read REPORT';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%kind not permitted%' THEN
                RAISE;
            END IF;
    END;

    PERFORM vc.ops_case_snapshot(v_priv, v_report_case);

    BEGIN
        PERFORM vc.ops_case_snapshot(v_priv, v_safety_case);
        RAISE EXCEPTION 'PRIVACY_OPERATOR must not read SAFETY';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%kind not permitted%' THEN
                RAISE;
            END IF;
    END;

    PERFORM vc.ops_case_snapshot(v_view, v_report_case);

    BEGIN
        PERFORM vc.read_ops_case_internal_note(v_view, v_report_case);
        RAISE EXCEPTION 'OPS_VIEWER must not read internal_note';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%body access denied%' THEN
                RAISE;
            END IF;
    END;

    PERFORM vc.read_ops_case_internal_note(v_priv, v_report_case);
    SELECT count(*) INTO v_n FROM vc.ops_case_event
     WHERE case_id = v_report_case AND event_type = 'BODY_ACCESS';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'BODY_ACCESS must be audited, got %', v_n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
