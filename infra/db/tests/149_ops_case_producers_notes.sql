-- 149_ops_case_producers_notes: S0-14 intake producers, monotonic workflow,
-- specialist RBAC, redacted/public notes and BODY_ACCESS audit.

\set ON_ERROR_STOP on

TRUNCATE vc.ops_case_event, vc.ops_case, vc.age_appeal, vc.age_verification,
         vc.safety_event, vc.report_request, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_safety bigint;
    v_privacy bigint;
    v_viewer bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-case-producer', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'user-case-producer', '$2a$10$user.hash.placeholder',
        'USER', 'User') INTO v_user;
    SELECT vc.identity_account_create(
        v_admin, 'safety-case-producer', '$2a$10$safe.hash.placeholder',
        'SAFETY_REVIEWER', 'Safety') INTO v_safety;
    SELECT vc.identity_account_create(
        v_admin, 'privacy-case-producer', '$2a$10$priv.hash.placeholder',
        'PRIVACY_OPERATOR', 'Privacy') INTO v_privacy;
    SELECT vc.identity_account_create(
        v_admin, 'viewer-case-producer', '$2a$10$view.hash.placeholder',
        'OPS_VIEWER', 'Viewer') INTO v_viewer;
    PERFORM set_config('t.admin', v_admin::text, false);
    PERFORM set_config('t.user', v_user::text, false);
    PERFORM set_config('t.safety', v_safety::text, false);
    PERFORM set_config('t.privacy', v_privacy::text, false);
    PERFORM set_config('t.viewer', v_viewer::text, false);
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'case-producers',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|case-producers', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_owner bigint := current_setting('t.user')::bigint;
    v_report bigint;
    v_r2 bigint;
    v_r3 bigint;
    v_r4 bigint;
    v_appeal bigint;
BEGIN
    v_report := vc.create_report(v_owner, NULL, 'OTHER', 'producer test');
    v_r2 := vc.record_safety_event(v_owner, NULL, 'INPUT', 'R2_ELEVATED', 'r2-test');
    v_r3 := vc.record_safety_event(v_owner, NULL, 'INPUT', 'R3_HIGH', 'r3-test');
    v_r4 := vc.record_safety_event(v_owner, NULL, 'INPUT', 'R4_IMMINENT', 'r4-test');
    PERFORM vc.record_age_verification(v_owner, 'ADULT_SELF_DECLARED', 'sim');
    PERFORM vc.record_age_verification(v_owner, 'ADULT_VERIFICATION_REQUIRED', 'sim');
    v_appeal := vc.submit_age_appeal(v_owner, 'age producer test');
    PERFORM set_config('t.report', v_report::text, false);
    PERFORM set_config('t.r2', v_r2::text, false);
    PERFORM set_config('t.r3', v_r3::text, false);
    PERFORM set_config('t.r4', v_r4::text, false);
    PERFORM set_config('t.appeal', v_appeal::text, false);
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_owner bigint := current_setting('t.user')::bigint;
    v_count integer;
    v_case bigint;
    v_status text;
    v_severity text;
BEGIN
    SELECT count(*) INTO v_count FROM vc.ops_case;
    IF v_count <> 4 THEN
        RAISE EXCEPTION 'report/R3/R4/appeal must produce four cases, got %', v_count;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.ops_case
        WHERE kind = 'SAFETY' AND source_id = current_setting('t.r2')::bigint) THEN
        RAISE EXCEPTION 'R2 must not create a human escalation case';
    END IF;

    SELECT id, status, severity INTO v_case, v_status, v_severity
      FROM vc.ops_case WHERE kind = 'SAFETY'
       AND source_owner_user_id = v_owner
       AND source_id = current_setting('t.r4')::bigint;
    IF v_status <> 'ESCALATED' OR v_severity <> 'P0' THEN
        RAISE EXCEPTION 'R4 must auto-escalate as P0, got % %', v_status, v_severity;
    END IF;
    PERFORM set_config('t.r4_case', v_case::text, false);
    SELECT count(*) INTO v_count FROM vc.ops_case_event
     WHERE case_id = v_case AND event_type IN ('OPENED', 'ESCALATE')
       AND actor_account_id IS NULL;
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'R4 system open/escalate events missing, got %', v_count;
    END IF;

    SELECT id INTO v_case FROM vc.ops_case WHERE kind = 'REPORT'
     AND source_owner_user_id = v_owner
     AND source_id = current_setting('t.report')::bigint;
    PERFORM set_config('t.report_case', v_case::text, false);
    SELECT id INTO v_case FROM vc.ops_case WHERE kind = 'AGE_APPEAL'
     AND source_owner_user_id = v_owner
     AND source_id = current_setting('t.appeal')::bigint;
    PERFORM set_config('t.appeal_case', v_case::text, false);
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_note text;
    v_status text;
    v_denied boolean;
BEGIN
    PERFORM vc.update_ops_case_note(
        current_setting('t.privacy')::bigint,
        current_setting('t.report_case')::bigint,
        'INTERNAL', 'internal review detail');
    PERFORM vc.update_ops_case_note(
        current_setting('t.privacy')::bigint,
        current_setting('t.report_case')::bigint,
        'PUBLIC', '已完成人工复核');
    SELECT vc.read_ops_case_internal_note(
        current_setting('t.privacy')::bigint,
        current_setting('t.report_case')::bigint) INTO v_note;
    IF v_note <> 'internal review detail' THEN
        RAISE EXCEPTION 'authorized internal note read failed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM vc.read_ops_case_internal_note(
            current_setting('t.viewer')::bigint,
            current_setting('t.report_case')::bigint);
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%body access denied%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'OPS_VIEWER must not read internal note';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.transition_ops_case(
            current_setting('t.privacy')::bigint,
            current_setting('t.report_case')::bigint,
            'ASSIGN', current_setting('t.safety')::bigint, NULL);
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%assignee is not permitted%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'wrong-specialty assignee must fail closed';
    END IF;

    SELECT out_status INTO v_status FROM vc.transition_ops_case(
        current_setting('t.privacy')::bigint,
        current_setting('t.report_case')::bigint,
        'ASSIGN', current_setting('t.privacy')::bigint, NULL);
    IF v_status <> 'ASSIGNED' THEN
        RAISE EXCEPTION 'permitted assignment failed';
    END IF;
    SELECT out_status INTO v_status FROM vc.transition_ops_case(
        current_setting('t.privacy')::bigint,
        current_setting('t.report_case')::bigint,
        'RESOLVE', NULL, 'review complete');
    IF v_status <> 'RESOLVED' THEN
        RAISE EXCEPTION 'report resolution failed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.transition_ops_case(
            current_setting('t.privacy')::bigint,
            current_setting('t.appeal_case')::bigint,
            'RESOLVE', NULL, 'generic resolve');
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%requires a review decision%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'age appeal must require dedicated decision';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.transition_ops_case(
            current_setting('t.safety')::bigint,
            current_setting('t.r4_case')::bigint,
            'ACK', NULL, NULL);
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%ACK would regress%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'ACK must not regress an escalated R4 case';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
    v_status text;
    v_note text;
BEGIN
    SELECT count(*) INTO v_count FROM vc.ops_case_event
     WHERE case_id = current_setting('t.report_case')::bigint
       AND event_type IN ('NOTE', 'PUBLIC_NOTE', 'BODY_ACCESS', 'ASSIGN', 'RESOLVE')
       AND actor_account_id = current_setting('t.privacy')::bigint;
    IF v_count <> 5 THEN
        RAISE EXCEPTION 'operator note/body/workflow audit incomplete, got %', v_count;
    END IF;
    SELECT status, resolution_note INTO v_status, v_note FROM vc.report_request
     WHERE owner_user_id = current_setting('t.user')::bigint
       AND id = current_setting('t.report')::bigint;
    IF v_status <> 'RESOLVED' OR v_note <> '已完成人工复核' THEN
        RAISE EXCEPTION 'report owner status/public note not synchronized';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.ops_case_event
        WHERE event_type IN ('NOTE', 'PUBLIC_NOTE', 'BODY_ACCESS')
          AND (from_status IS NOT NULL OR to_status IS NOT NULL)) THEN
        RAISE EXCEPTION 'note/body audit must not copy note or body into status fields';
    END IF;
    IF has_table_privilege('vc_api', 'vc.ops_case_event', 'SELECT') THEN
        RAISE EXCEPTION 'vc_api must not directly read case audit rows';
    END IF;
END $$;
