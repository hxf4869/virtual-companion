-- 123_safety_queue_sla_age_hours: METRICS-ALERT V69 — the admin safety
-- queue reports row age so R3/R4 SLA breach is visible without a threshold
-- in SQL. Covers: out_age_hours is returned and ~0 for a fresh event;
-- signature/grants are unchanged (vc_api only, PUBLIC revoked).

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
    v_age   numeric;
    n       int;
BEGIN
    SELECT vc.identity_admin_seed('root-sla', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-sla', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

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
      FROM vc.receive_generation(v_user, 1, 'sla-key-1', 'user', 'hello');

    PERFORM vc.record_safety_event(
        v_user, v_gen, 'INPUT', 'R4_IMMINENT', 'input-imminent-self-harm');

    -- The queue now carries the observable fact: how old the row is.
    SET LOCAL ROLE vc_api;
    SELECT out_age_hours INTO v_age
      FROM vc.list_safety_events(v_admin, NULL, 50);
    IF v_age IS NULL THEN
        RAISE EXCEPTION 'age_hours must be returned';
    END IF;
    IF v_age < 0 OR v_age > 1 THEN
        RAISE EXCEPTION 'fresh event age_hours must be within [0,1], got %', v_age;
    END IF;

    -- Keyset shape unchanged: limit still clamps.
    SELECT count(*) INTO n FROM vc.list_safety_events(v_admin, NULL, 1);
    IF n <> 1 THEN
        RAISE EXCEPTION 'limit must clamp to 1, got %', n;
    END IF;
    RESET ROLE;
END $$;

-- Grants unchanged: PUBLIC/vc_worker has no execute path.
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
