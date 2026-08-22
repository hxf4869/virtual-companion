-- 141_ops_case_actions: S0-14-C V90 — ACK/ASSIGN/ESCALATE/RESOLVE;
-- OPS_VIEWER cannot mutate; RESOLVE requires disposition_reason.

\set ON_ERROR_STOP on

TRUNCATE vc.ops_case_event, vc.ops_case, vc.report_request, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_view bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-act', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-act', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;
    SELECT vc.identity_account_create(
        v_admin, 'view-act', '$2a$10$view.hash.placeholder', 'OPS_VIEWER', 'View') INTO v_view;
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.alice', v_user::text, false);
    PERFORM set_config('t.view', v_view::text, false);
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
    v_view bigint := current_setting('t.view')::bigint;
    v_report bigint;
    v_case bigint;
    v_status text;
BEGIN
    v_report := vc.create_report(v_user, NULL, 'OTHER', 'act');
    SELECT out_id INTO v_case FROM vc.open_ops_case(v_admin, 'REPORT', v_user, v_report, 'P2');

    BEGIN
        PERFORM vc.transition_ops_case(v_view, v_case, 'ACK', NULL, NULL);
        RAISE EXCEPTION 'OPS_VIEWER must not mutate';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%mutation denied%' THEN
                RAISE;
            END IF;
    END;

    SELECT out_status INTO v_status FROM vc.transition_ops_case(v_admin, v_case, 'ACK', NULL, NULL);
    IF v_status IS DISTINCT FROM 'ACKNOWLEDGED' THEN
        RAISE EXCEPTION 'ACK must reach ACKNOWLEDGED, got %', v_status;
    END IF;

    SELECT out_status INTO v_status
      FROM vc.transition_ops_case(v_admin, v_case, 'ASSIGN', v_admin, NULL);
    IF v_status IS DISTINCT FROM 'ASSIGNED' THEN
        RAISE EXCEPTION 'ASSIGN must reach ASSIGNED, got %', v_status;
    END IF;

    BEGIN
        PERFORM vc.transition_ops_case(v_admin, v_case, 'RESOLVE', NULL, NULL);
        RAISE EXCEPTION 'RESOLVE without disposition must fail';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%disposition_reason is required%' THEN
                RAISE;
            END IF;
    END;

    SELECT out_status INTO v_status
      FROM vc.transition_ops_case(v_admin, v_case, 'RESOLVE', NULL, 'no further action');
    IF v_status IS DISTINCT FROM 'RESOLVED' THEN
        RAISE EXCEPTION 'RESOLVE must reach RESOLVED, got %', v_status;
    END IF;
END $$;
COMMIT;
RESET ROLE;
