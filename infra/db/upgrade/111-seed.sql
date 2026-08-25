-- 111-seed: DOGFOOD-STABILIZATION-04 audit defect A — the V111→latest
-- UPGRADE fixture. Runs on a database migrated ONLY to V111, BEFORE
-- V112+ apply. It builds the pre-migration world with the functions as they
-- existed at V111 (terminalize INPUT_BLOCKED / cancel_generation existed;
-- the model_eligible column did NOT): blocked and cancelled turns whose
-- messages are, at this point, indistinguishable from clean ones.
--
-- TRUNCATE-then-insert is NOT used anywhere: the rows below are the actual
-- legacy rows the backfill must repair in place.

\set ON_ERROR_STOP on

-- NOTE: the truncate list only names tables that already exist at V111
-- (the database here is migrated ONLY to V111 — export_upload_intent does
-- not exist yet; a fresh container needs no residue cleanup anyway).
TRUNCATE vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.account_deletion_intent, vc.vc_user CASCADE;

-- The V27 owner-binding key is provisioned at application startup in real
-- deployments (OwnerBindingSecretBootstrap); the ephemeral upgrade container
-- has no application process, so seed the same FIXED test-only key the rls
-- harness uses (tests/00_owner_binding_secret_seed.sql).
INSERT INTO vc._owner_binding_secret(id, secret)
VALUES (1, 'vc-test-owner-binding-secret-0123456789abcdef')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'legacy');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);

BEGIN;
SELECT vc.set_owner_context(1, 's1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 's1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_blocked   bigint;
    v_cancelled bigint;
    v_regenerated bigint;
BEGIN
    -- Legacy INPUT_BLOCKED turn (V58 flow as of V111).
    SELECT message_id INTO v_blocked
      FROM vc.receive_generation(1, 1, 'legacy-blocked', 'user',
                                 '我的手机号是13800138000，别外发');
    PERFORM vc.promote_generation(
        1, (SELECT id FROM vc.generation
             WHERE owner_user_id = 1 AND idempotency_key = 'legacy-blocked'),
        'INPUT_REVIEW');
    PERFORM vc.terminalize_generation(
        1, (SELECT id FROM vc.generation
             WHERE owner_user_id = 1 AND idempotency_key = 'legacy-blocked'),
        'INPUT_BLOCKED', 'chat.blocked');

    -- Legacy OUTPUT_BLOCKED turn: needs a full walk to FINAL_REVIEW.
    PERFORM vc.receive_generation(1, 1, 'legacy-output', 'user', '试试输出拦截');
    PERFORM vc.promote_generation(
        1, (SELECT id FROM vc.generation
             WHERE owner_user_id = 1 AND idempotency_key = 'legacy-output'),
        'IN_PROGRESS');
    PERFORM vc.promote_generation(
        1, (SELECT id FROM vc.generation
             WHERE owner_user_id = 1 AND idempotency_key = 'legacy-output'),
        'FINAL_REVIEW');
    PERFORM vc.terminalize_generation(
        1, (SELECT id FROM vc.generation
             WHERE owner_user_id = 1 AND idempotency_key = 'legacy-output'),
        'OUTPUT_BLOCKED', 'chat.blocked');

    -- Legacy CANCELLED turn.
    SELECT message_id INTO v_cancelled
      FROM vc.receive_generation(1, 1, 'legacy-cancelled', 'user', '算了吧');
    PERFORM vc.cancel_generation(
        1, (SELECT id FROM vc.generation
             WHERE owner_user_id = 1 AND idempotency_key = 'legacy-cancelled'));

    -- Legacy clean turn (stays eligible) — the control group.
    PERFORM vc.receive_generation(1, 1, 'legacy-clean', 'user', '今天天气不错');
END;
$$;
COMMIT;
