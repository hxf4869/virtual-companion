-- 111_reports_age_appeal: REPORT-BE / AGE-APPEAL V56 — report & age-appeal
-- intake.
--
-- Covers: create_report appends an owned report (message anchor optional,
-- note trimmed); a foreign or absent anchor returns 0 (existence hidden);
-- unapproved reasons and oversized notes raise; list/get stay owner-scoped
-- keyset. submit_age_appeal flips the effective age state to
-- AGE_APPEAL_PENDING only from ADULT_VERIFICATION_REQUIRED /
-- MINOR_SUSPECTED (AGE_UNKNOWN and a second submission fail closed);
-- list_age_appeals stays owner-scoped. Non-vc_api roles cannot execute.

\set ON_ERROR_STOP on

TRUNCATE vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
VALUES (1, 10, 1, 'user', '这条消息被举报'),
       (1, 11, 1, 'assistant', '这条回复被举报');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_report bigint;
    v_n      int;
    v_note   text;
    v_state  text;
    v_appeal bigint;
BEGIN
    -- Anchored report: note is stored trimmed.
    SELECT vc.create_report(1, 10, 'UNSAFE_CONTENT', '  内容让我不安  ')
      INTO v_report;
    IF v_report IS NULL OR v_report <= 0 THEN
        RAISE EXCEPTION 'anchored create_report must return an id';
    END IF;
    SELECT out_note INTO v_note FROM vc.get_report(1, v_report);
    IF v_note <> '内容让我不安' THEN
        RAISE EXCEPTION 'note must be stored trimmed, got %', v_note;
    END IF;

    -- Unanchored (general) report.
    IF vc.create_report(1, NULL, 'PRIVACY_OR_DATA', '导出数据不完整') <= 0 THEN
        RAISE EXCEPTION 'general create_report must return an id';
    END IF;

    -- Absent or foreign anchor hides existence (0, no row).
    IF vc.create_report(1, 999999, 'OTHER', 'x') <> 0 THEN
        RAISE EXCEPTION 'absent message anchor must return 0';
    END IF;

    -- Unapproved reason and oversized note fail closed.
    BEGIN
        PERFORM vc.create_report(1, NULL, 'NOT_A_REASON', 'x');
        RAISE EXCEPTION 'unapproved reason unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved reason unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%unapproved report reason%' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.create_report(1, NULL, 'OTHER', repeat('x', 2001));
        RAISE EXCEPTION 'oversized note unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%oversized note unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%note must be%' THEN
            RAISE;
        END IF;
    END;

    -- Owner-scoped keyset list: 2 rows, newest first.
    SELECT count(*) INTO v_n FROM vc.list_reports(1, NULL, 20);
    IF v_n <> 2 THEN
        RAISE EXCEPTION 'list_reports must return 2, got %', v_n;
    END IF;
    -- The after cursor is the last id seen: rows strictly older follow.
    SELECT count(*) INTO v_n FROM vc.list_reports(1, v_report + 1, 20);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'after-cursor must page the older row only, got %', v_n;
    END IF;

    -- Absent report id yields no rows (existence hidden).
    SELECT count(*) INTO v_n FROM vc.get_report(1, 999999999);
    IF v_n <> 0 THEN
        RAISE EXCEPTION 'absent report must yield no rows';
    END IF;

    -- Age appeal: AGE_UNKNOWN cannot appeal (fail closed).
    BEGIN
        PERFORM vc.submit_age_appeal(1, '判错了');
        RAISE EXCEPTION 'AGE_UNKNOWN appeal unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%AGE_UNKNOWN appeal unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%cannot submit an appeal%' THEN
            RAISE;
        END IF;
    END;

    -- Walk to ADULT_VERIFICATION_REQUIRED, then appeal succeeds and flips
    -- the effective state to AGE_APPEAL_PENDING.
    PERFORM vc.record_age_verification(1, 'ADULT_SELF_DECLARED', 'sim');
    PERFORM vc.record_age_verification(1, 'ADULT_VERIFICATION_REQUIRED', 'sim');
    SELECT vc.submit_age_appeal(1, '  核验结果有误，我是成年人  ') INTO v_appeal;
    IF v_appeal IS NULL OR v_appeal <= 0 THEN
        RAISE EXCEPTION 'submit_age_appeal must return an id';
    END IF;
    SELECT out_age_state INTO v_state FROM vc.get_age_state(1);
    IF v_state <> 'AGE_APPEAL_PENDING' THEN
        RAISE EXCEPTION 'appeal must flip the state, got %', v_state;
    END IF;

    -- A second submission while AGE_APPEAL_PENDING fails closed.
    BEGIN
        PERFORM vc.submit_age_appeal(1, '再提一次');
        RAISE EXCEPTION 'second appeal unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%second appeal unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%cannot submit an appeal%' THEN
            RAISE;
        END IF;
    END;

    SELECT count(*) INTO v_n FROM vc.list_age_appeals(1, NULL, 20);
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'list_age_appeals must return 1, got %', v_n;
    END IF;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
BEGIN
    -- Cross-owner isolation: alice's message anchor and rows are invisible.
    IF vc.create_report(2, 10, 'OTHER', 'x') <> 0 THEN
        RAISE EXCEPTION 'foreign message anchor must return 0';
    END IF;
    SELECT count(*) INTO n FROM vc.list_reports(2, NULL, 20);
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner must not see alice reports';
    END IF;
    SELECT count(*) INTO n FROM vc.get_report(2, 1);
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner must not read alice report';
    END IF;
    SELECT count(*) INTO n FROM vc.list_age_appeals(2, NULL, 20);
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner must not see alice appeals';
    END IF;

    -- Trusted-owner assertion: bob's context cannot write alice's rows.
    BEGIN
        PERFORM vc.submit_age_appeal(1, '越权提交');
        RAISE EXCEPTION 'owner-mismatched appeal unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%owner-mismatched appeal unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN
            RAISE;
        END IF;
    END;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.create_report(1, NULL, 'OTHER', 'x');
    RAISE EXCEPTION 'vc_worker unexpectedly executed create_report';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
