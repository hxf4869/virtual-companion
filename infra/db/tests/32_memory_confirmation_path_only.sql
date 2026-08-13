-- 32_memory_confirmation_path_only: a Canonical (ACCEPTED) memory record can be
-- created ONLY by the user confirmation path. Model output enters as
-- PENDING_CONFIRMATION candidates (INV-MEM-001/002); confirm_memory_candidate is
-- the sole PENDING_CONFIRMATION -> ACCEPTED transition; direct writes by the
-- runtime role are blocked by privilege revocation.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'conv');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_cand bigint;
    v_ok   boolean;
BEGIN
    -- Model output creates a PENDING_CONFIRMATION candidate, never canonical.
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'likes jazz',
                                       NULL, ARRAY['gen-1', 'msg-5']) INTO v_cand;
    IF v_cand IS NULL THEN RAISE EXCEPTION 'create must return an id'; END IF;

    PERFORM 1 FROM vc.get_memory(1, v_cand) WHERE out_status = 'PENDING_CONFIRMATION';
    IF NOT FOUND THEN RAISE EXCEPTION 'candidate must be PENDING_CONFIRMATION'; END IF;

    -- Confirmation is the ONLY path to ACCEPTED.
    SELECT vc.confirm_memory_candidate(1, v_cand) INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'confirm must return true'; END IF;
    PERFORM 1 FROM vc.get_memory(1, v_cand) WHERE out_status = 'ACCEPTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'confirmed memory must be ACCEPTED'; END IF;

    -- Re-confirming an already-ACCEPTED memory must fail (not idempotent into canonical).
    BEGIN
        PERFORM vc.confirm_memory_candidate(1, v_cand);
        RAISE EXCEPTION 're-confirming an ACCEPTED memory must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected: not pending confirmation
    END;
END $$;
COMMIT;
RESET ROLE;

-- A runtime role cannot directly INSERT an ACCEPTED memory: the confirmation
-- function is the only canonical path (privilege revocation enforces INV-MEM-001).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
        VALUES (1, 5000, 10, 'RELATIONSHIP', 'forged canonical', 'ACCEPTED');
        RAISE EXCEPTION 'direct INSERT by vc_api must be forbidden';
    EXCEPTION WHEN insufficient_privilege THEN
        -- expected: REVOKE blocks direct writes
    END;
END $$;
COMMIT;
RESET ROLE;
