-- 113_safety_wire: SAFETY-WIRE V58 — safety events + catalog input-block
-- edges.
--
-- Covers: CREATED → INPUT_REVIEW → INPUT_BLOCKED with a durable chat.blocked
-- event (catalog path, never an illegal shortcut); the pre-existing
-- FINAL_REVIEW → OUTPUT_BLOCKED edge still works; record_safety_event
-- validates stage/risk codes, asserts the trusted owner and is vc_api-only;
-- no content is stored — only stage, catalog risk level and rule id.

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

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true), (2, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL), (2, 1, 1, NULL);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_gen    bigint;
    v_status text;
    v_ev     bigint;
    n        int;
BEGIN
    -- Input-block path: receive (message + CREATED generation), then the
    -- catalog walk CREATED -> INPUT_REVIEW -> INPUT_BLOCKED.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, 1, 'safety-input-1', 'user', '我想自杀');

    SELECT vc.promote_generation(1, v_gen, 'INPUT_REVIEW') INTO v_status;
    IF v_status <> 'INPUT_REVIEW' THEN
        RAISE EXCEPTION 'promote to INPUT_REVIEW failed, got %', v_status;
    END IF;

    -- INPUT_REVIEW cannot jump into the normal pipeline.
    BEGIN
        PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
        RAISE EXCEPTION 'INPUT_REVIEW -> IN_PROGRESS unexpectedly allowed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%illegal transition%' THEN
            RAISE;
        END IF;
    END;

    SELECT vc.terminalize_generation(
        1, v_gen, 'INPUT_BLOCKED', 'chat.blocked',
        '{"rule":"input-imminent-self-harm"}'::jsonb) INTO v_status;
    IF v_status <> 'INPUT_BLOCKED' THEN
        RAISE EXCEPTION 'terminalize to INPUT_BLOCKED failed, got %', v_status;
    END IF;

    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = v_gen
       AND event_type = 'chat.blocked';
    IF n <> 1 THEN
        RAISE EXCEPTION 'input block must leave exactly one chat.blocked event, got %', n;
    END IF;

    -- INPUT_BLOCKED is terminal: no further transition.
    BEGIN
        PERFORM vc.terminalize_generation(
            1, v_gen, 'FAILED_FINAL', 'chat.failed', '{}'::jsonb);
        RAISE EXCEPTION 'INPUT_BLOCKED -> FAILED_FINAL unexpectedly allowed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%illegal transition%' THEN
            RAISE;
        END IF;
    END;

    -- Safety event: valid row, minimal fields only.
    SELECT vc.record_safety_event(
        1, v_gen, 'INPUT', 'R4_IMMINENT', 'input-imminent-self-harm') INTO v_ev;
    IF v_ev IS NULL OR v_ev <= 0 THEN
        RAISE EXCEPTION 'record_safety_event must return an id';
    END IF;

    -- Unapproved stage / risk / blank rule fail closed.
    BEGIN
        PERFORM vc.record_safety_event(1, v_gen, 'OUTPUT', 'R3_HIGH', 'x');
        RAISE EXCEPTION 'unapproved stage unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%unapproved stage%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.record_safety_event(1, v_gen, 'FINAL', 'R9_??', 'x');
        RAISE EXCEPTION 'unapproved risk unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%unapproved risk level%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.record_safety_event(1, v_gen, 'FINAL', 'R3_HIGH', '   ');
        RAISE EXCEPTION 'blank rule id unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%rule_id%' THEN RAISE; END IF;
    END;

    -- Output-block path (pre-existing edge, redefined function): a second
    -- generation walks CREATED -> IN_PROGRESS -> FINAL_REVIEW -> OUTPUT_BLOCKED.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, 1, 'safety-output-1', 'user', '聊点别的');
    PERFORM vc.promote_generation(1, v_gen, 'IN_PROGRESS');
    PERFORM vc.promote_generation(1, v_gen, 'FINAL_REVIEW');
    SELECT vc.terminalize_generation(
        1, v_gen, 'OUTPUT_BLOCKED', 'chat.blocked',
        '{"rule":"output-ai-identity-human-claim"}'::jsonb) INTO v_status;
    IF v_status <> 'OUTPUT_BLOCKED' THEN
        RAISE EXCEPTION 'terminalize to OUTPUT_BLOCKED failed, got %', v_status;
    END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = v_gen
       AND event_type = 'chat.blocked';
    IF n <> 1 THEN
        RAISE EXCEPTION 'output block must leave exactly one chat.blocked event';
    END IF;
    SELECT vc.record_safety_event(
        1, v_gen, 'FINAL', 'R3_HIGH', 'output-ai-identity-human-claim') INTO v_ev;

    -- Failed/fallback pairings must still be enforced.
    BEGIN
        PERFORM vc.terminalize_generation(
            1, v_gen, 'FAILED_FINAL', 'chat.completed', '{}'::jsonb);
        RAISE EXCEPTION 'mismatched event/status unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%does not match%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    -- Trusted-owner assertion: bob's context cannot write alice's safety rows.
    BEGIN
        PERFORM vc.record_safety_event(1, NULL, 'INPUT', 'R4_IMMINENT', 'x');
        RAISE EXCEPTION 'owner-mismatched safety event unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
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
    PERFORM vc.record_safety_event(1, NULL, 'INPUT', 'R3_HIGH', 'x');
    RAISE EXCEPTION 'vc_worker unexpectedly executed record_safety_event';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
