-- 125_job_daily_active_users: METRICS-ALERT V77 — the metrics scheduler's
-- DAU source. Covers: distinct owners with a generation since the day start
-- are counted once each; a day start in the future counts nobody; NULL
-- day_start fails closed; only vc_api may execute (PUBLIC revoked,
-- vc_worker denied).

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
    v_user1 bigint;
    v_user2 bigint;
    n       bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-dau', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-dau', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user1;
    SELECT vc.identity_account_create(
        v_admin, 'bob-dau', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_user2;

    -- Two owners, one generation each (user1 turns twice — still one DAU).
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user1, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user1, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_user1, 'd1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_user1 || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'd1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.receive_generation(v_user1, 1, 'dau-key-1', 'user', 'hello');
    PERFORM vc.receive_generation(v_user1, 1, 'dau-key-2', 'user', 'again');

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user2, 2, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user2, 2, 2, NULL);
    PERFORM vc.set_owner_context(v_user2, 'd2', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_user2 || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'd2', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    PERFORM vc.receive_generation(v_user2, 2, 'dau-key-3', 'user', 'hi');

    RESET ROLE;
    SET LOCAL ROLE vc_api;

    -- A day start before both owners' generations: distinct owners counted
    -- once each (user1's two turns collapse to one).
    SELECT vc.job_daily_active_users(now() - interval '1 day') INTO n;
    IF n IS DISTINCT FROM 2 THEN
        RAISE EXCEPTION 'distinct-owner DAU must be 2, got %', n;
    END IF;

    -- A future day start counts nobody.
    SELECT vc.job_daily_active_users(now() + interval '1 day') INTO n;
    IF n IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'future day start must count 0, got %', n;
    END IF;

    -- NULL day_start fails closed.
    BEGIN
        PERFORM vc.job_daily_active_users(NULL);
        RAISE EXCEPTION 'NULL day_start must raise';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%day_start is required%' THEN
                RAISE;
            END IF;
    END;

    RESET ROLE;
END $$;

-- Grants: vc_worker has no execute path.
BEGIN;
SELECT vc.set_owner_context(1, 'd3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'd3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.job_daily_active_users(now() - interval '1 day');
    RAISE EXCEPTION 'vc_worker unexpectedly executed job_daily_active_users';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
