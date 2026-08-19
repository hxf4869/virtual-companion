-- 114_safety_queue_admin: SAFETY-QUEUE V59 — ADMIN-only safety-queue read.
--
-- Covers: list_safety_events returns safety rows across owners newest-first
-- with an exclusive after cursor; a non-ADMIN acting account fails closed
-- inside the SD; the read crosses owner isolation on purpose (the queue is
-- cross-tenant by design, guarded only by the ACTIVE ADMIN re-verification).

\set ON_ERROR_STOP on

TRUNCATE vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
    v_rel   bigint;
    v_gen   bigint;
    v_ev    bigint;
    n       int;
BEGIN
    SELECT vc.identity_admin_seed('root-safety', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-safety', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_user, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_user || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_user, 1, 'safety-key-1', 'user', 'hello');

    -- Two safety events: newest first means the FINAL row surfaces before INPUT.
    SELECT vc.record_safety_event(
        v_user, v_gen, 'INPUT', 'R4_IMMINENT', 'input-imminent-self-harm') INTO v_ev;
    PERFORM vc.record_safety_event(
        v_user, v_gen, 'FINAL', 'R3_HIGH', 'output-ai-identity-human-claim');

    -- ADMIN read: cross-owner, newest first, exclusive after cursor.
    SET LOCAL ROLE vc_api;
    SELECT count(*) INTO n FROM vc.list_safety_events(v_admin, NULL, 50);
    IF n <> 2 THEN
        RAISE EXCEPTION 'admin must see both safety rows, got %', n;
    END IF;
    -- The after cursor is exclusive (id < after): above the newest keeps all;
    -- at the newest (FINAL, v_ev+1) leaves only the older INPUT row.
    SELECT count(*) INTO n FROM vc.list_safety_events(v_admin, v_ev + 2, 50);
    IF n <> 2 THEN
        RAISE EXCEPTION 'after-cursor above the newest must keep both rows, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_safety_events(v_admin, v_ev + 1, 50);
    IF n <> 1 THEN
        RAISE EXCEPTION 'after-cursor at the newest must leave the older row, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_safety_events(v_admin, v_ev, 50);
    IF n <> 0 THEN
        RAISE EXCEPTION 'after-cursor below the oldest must leave nothing, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_safety_events(v_admin, NULL, 1);
    IF n <> 1 THEN
        RAISE EXCEPTION 'limit must clamp to 1, got %', n;
    END IF;
    RESET ROLE;

    -- A non-ADMIN acting account fails closed inside the SD.
    SET LOCAL ROLE vc_api;
    BEGIN
        PERFORM vc.list_safety_events(v_user, NULL, 50);
        RAISE EXCEPTION 'non-admin unexpectedly read the safety queue';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
            RAISE;
        END IF;
    END;
    RESET ROLE;
END $$;

BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.list_safety_events(1, NULL, 50);
    RAISE EXCEPTION 'vc_worker unexpectedly executed list_safety_events';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
