-- 139_ops_case: S0-14-A V88 — freeze case envelope. Admin opens an idempotent
-- case over existing intake; snapshot omits internal_note; sla_hours stays
-- NULL (no promise); runtime roles have no table DML.

\set ON_ERROR_STOP on

TRUNCATE vc.ops_case_event, vc.ops_case, vc.report_request, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_report bigint;
    v_case bigint;
    v_inserted boolean;
    v_again bigint;
    v_again_inserted boolean;
    v_status text;
    v_sla integer;
    v_n integer;
BEGIN
    SELECT vc.identity_admin_seed('root-case', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-case', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.alice', v_user::text, false);
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
    v_report bigint;
    v_case bigint;
    v_inserted boolean;
    v_again bigint;
    v_status text;
    v_sla integer;
    v_n integer;
BEGIN
    v_report := vc.create_report(v_user, NULL, 'UNSAFE_CONTENT', 'case freeze');
    IF v_report IS NULL OR v_report <= 0 THEN
        RAISE EXCEPTION 'create_report must return an id';
    END IF;

    SELECT out_id, out_inserted INTO v_case, v_inserted
      FROM vc.open_ops_case(v_admin, 'REPORT', v_user, v_report, 'P2');
    IF v_case IS NULL OR v_inserted IS NOT FALSE THEN
        RAISE EXCEPTION 'intake trigger must open the case before manual idempotent lookup';
    END IF;

    SELECT out_id, out_inserted INTO v_again, v_inserted
      FROM vc.open_ops_case(v_admin, 'REPORT', v_user, v_report, 'P2');
    IF v_again IS DISTINCT FROM v_case OR v_inserted IS NOT FALSE THEN
        RAISE EXCEPTION 'open_ops_case must be idempotent';
    END IF;

    SELECT out_status, out_sla_hours INTO v_status, v_sla
      FROM vc.ops_case_snapshot(v_admin, v_case);
    IF v_status IS DISTINCT FROM 'OPEN' OR v_sla IS NOT NULL THEN
        RAISE EXCEPTION 'fresh case must be OPEN with null sla_hours, got % %', v_status, v_sla;
    END IF;

    BEGIN
        PERFORM vc.open_ops_case(v_user, 'REPORT', v_user, v_report, 'P2');
        RAISE EXCEPTION 'non-admin must not open a case';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        INSERT INTO vc.ops_case(kind, source_owner_user_id, source_id, severity)
        VALUES ('REPORT', v_user, v_report + 1, 'P2');
        RAISE EXCEPTION 'direct INSERT on ops_case must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;
