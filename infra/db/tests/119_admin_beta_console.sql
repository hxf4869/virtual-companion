-- 119_admin_beta_console: ADMIN-BETA V64 — read-only cross-owner console
-- queues.
--
-- Covers: the four ADMIN-only queue reads (reports, age appeals, export
-- tasks, memory-anomaly sampling) return cross-owner rows newest-first with
-- an exclusive after cursor and a clamped limit; memory sampling picks only
-- non-ACCEPTED or soft-deleted rows (a live ACCEPTED row is never sampled);
-- a non-ADMIN or non-positive acting account fails closed inside each SD;
-- vc_worker cannot execute.

\set ON_ERROR_STOP on

TRUNCATE vc.conversation_summary, vc.memory_embedding, vc.trial_grant,
         vc.entitlement_snapshot, vc.service_class_assignment,
         vc.quota_ledger_entry, vc.invite_code, vc.safety_event, vc.age_appeal,
         vc.report_request, vc.age_verification, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.export_request,
         vc.consent_record, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
    v_id    bigint;
    v_done  timestamptz;
    n       int;
BEGIN
    SELECT vc.identity_admin_seed('root-adm', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-adm', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-adm', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true), (v_bob, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL), (v_bob, 1, 1, NULL);
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (v_alice, 10, 1, 'user', '被举报的消息'),
           (v_bob, 10, 1, 'user', 'bob 的消息');

    -- Cross-owner queue seed with explicit ids (newest = largest id).
    INSERT INTO vc.report_request(owner_user_id, id, message_id, reason, note, status)
    VALUES (v_alice, 9001, 10, 'UNSAFE_CONTENT', '内容让我不安', 'SUBMITTED'),
           (v_bob, 9002, 10, 'AI_IDENTITY', '', 'SUBMITTED'),
           (v_alice, 9003, NULL, 'OTHER', '已人工处理', 'RESOLVED');
    INSERT INTO vc.age_appeal(owner_user_id, id, reason, status)
    VALUES (v_alice, 9101, '我已成年，证件刚更新', 'SUBMITTED'),
           (v_bob, 9102, '系统误判为未成年', 'SUBMITTED');
    INSERT INTO vc.export_request(owner_user_id, id, status, completed_at)
    VALUES (v_alice, 9201, 'PENDING', NULL),
           (v_bob, 9202, 'READY', now());
    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
    VALUES (v_alice, 9301, 1, 'RELATIONSHIP', '周五有汇报（正常确认）', 'ACCEPTED'),
           (v_alice, 9302, 1, 'RELATIONSHIP', '被拒绝的候选记忆', 'REJECTED'),
           (v_bob, 9303, 1, 'RELATIONSHIP', '已删除的记忆', 'ACCEPTED'),
           (v_bob, 9304, 1, 'RELATIONSHIP', '待确认候选', 'PENDING_CONFIRMATION');
    UPDATE vc.memory_item SET deleted_at = now()
     WHERE owner_user_id = v_bob AND id = 9303;

    SET LOCAL ROLE vc_api;

    -- Reports: cross-owner, newest first, exclusive cursor, clamped limit.
    SELECT count(*) INTO n FROM vc.admin_list_reports(v_admin, NULL, 50);
    IF n <> 3 THEN
        RAISE EXCEPTION 'admin must see all three reports, got %', n;
    END IF;
    SELECT out_id INTO v_id FROM vc.admin_list_reports(v_admin, NULL, 50);
    IF v_id <> 9003 THEN
        RAISE EXCEPTION 'reports must surface newest first, got %', v_id;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_list_reports(v_admin, 9002, 50) r
     WHERE r.out_message_id = 10 AND r.out_owner_user_id = v_alice;
    IF n <> 1 THEN
        RAISE EXCEPTION 'after-cursor must keep only the anchored alice row, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_list_reports(v_admin, 9001, 50);
    IF n <> 0 THEN
        RAISE EXCEPTION 'after-cursor at the oldest must leave nothing, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_list_reports(v_admin, NULL, 0);
    IF n <> 1 THEN
        RAISE EXCEPTION 'limit must clamp to at least 1, got %', n;
    END IF;

    -- Age appeals: two owners, newest first, exclusive cursor.
    SELECT count(*) INTO n FROM vc.admin_list_age_appeals(v_admin, NULL, 50);
    IF n <> 2 THEN
        RAISE EXCEPTION 'admin must see both appeals, got %', n;
    END IF;
    SELECT out_id INTO v_id FROM vc.admin_list_age_appeals(v_admin, NULL, 50);
    IF v_id <> 9102 THEN
        RAISE EXCEPTION 'appeals must surface newest first, got %', v_id;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_list_age_appeals(v_admin, 9102, 50) a
     WHERE a.out_owner_user_id = v_alice;
    IF n <> 1 THEN
        RAISE EXCEPTION 'after-cursor must keep only alice''s appeal, got %', n;
    END IF;

    -- Export tasks: statuses surface; the READY row carries completed_at.
    SELECT count(*) INTO n FROM vc.admin_list_export_tasks(v_admin, NULL, 50);
    IF n <> 2 THEN
        RAISE EXCEPTION 'admin must see both export tasks, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_list_export_tasks(v_admin, NULL, 50) e
     WHERE e.out_status = 'READY' AND e.out_completed_at IS NOT NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'the READY task must carry completed_at, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_list_export_tasks(v_admin, 9202, 50);
    IF n <> 1 THEN
        RAISE EXCEPTION 'after-cursor must keep the older task, got %', n;
    END IF;

    -- Memory sampling: only non-ACCEPTED or soft-deleted rows surface; the
    -- live ACCEPTED row (9301) is never sampled.
    SELECT count(*) INTO n FROM vc.admin_memory_sampling(v_admin, NULL, 50);
    IF n <> 3 THEN
        RAISE EXCEPTION 'sampling must return the three anomalous rows, got %', n;
    END IF;
    SELECT out_id INTO v_id FROM vc.admin_memory_sampling(v_admin, NULL, 50);
    IF v_id <> 9304 THEN
        RAISE EXCEPTION 'sampling must surface newest first, got %', v_id;
    END IF;
    SELECT count(*) INTO n FROM vc.admin_memory_sampling(v_admin, NULL, 50) m
     WHERE m.out_id = 9301;
    IF n <> 0 THEN
        RAISE EXCEPTION 'live ACCEPTED memory must not be sampled';
    END IF;
    SELECT count(*) INTO n FROM vc.admin_memory_sampling(v_admin, NULL, 50) m
     WHERE m.out_id = 9303 AND m.out_deleted_at IS NOT NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'soft-deleted memory must be sampled with deleted_at';
    END IF;

    RESET ROLE;

    -- A non-ADMIN acting account fails closed inside every SD.
    SET LOCAL ROLE vc_api;
    BEGIN
        PERFORM vc.admin_list_reports(v_alice, NULL, 50);
        RAISE EXCEPTION 'non-admin unexpectedly read the report queue';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.admin_list_age_appeals(v_bob, NULL, 50);
        RAISE EXCEPTION 'non-admin unexpectedly read the appeal queue';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.admin_list_export_tasks(v_alice, NULL, 50);
        RAISE EXCEPTION 'non-admin unexpectedly read the export queue';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.admin_memory_sampling(v_bob, NULL, 50);
        RAISE EXCEPTION 'non-admin unexpectedly read the memory sampling';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    -- Non-positive acting ids fail closed too.
    BEGIN
        PERFORM vc.admin_list_reports(0, NULL, 50);
        RAISE EXCEPTION 'zero admin id unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%admin account is required%' THEN RAISE; END IF;
    END;
    RESET ROLE;
END $$;

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.admin_list_reports(1, NULL, 50);
    RAISE EXCEPTION 'vc_worker unexpectedly executed admin_list_reports';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
