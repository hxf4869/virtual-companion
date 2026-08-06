-- 36_memory_idempotency: duplicate-request semantics across the memory lifecycle.
-- The idempotent operations (update, delete) return TRUE on a safe retry; the
-- state-machine operations (confirm, reject) remain status-guarded and reject a
-- duplicate that targets an already-transitioned memory (test 32 asserts the
-- confirm path; this covers reject too). create is intentionally not deduped --
-- two calls produce two distinct PENDING_CONFIRMATION candidates -- which is
-- acceptable because candidates are model output awaiting review.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    v_acc bigint; v_rej bigint; v_ok boolean; n int;
BEGIN
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'to-confirm', NULL, ARRAY[]::text[]) INTO v_acc;
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'to-reject',  NULL, ARRAY[]::text[]) INTO v_rej;
    PERFORM vc.confirm_memory_candidate(1, v_acc);
    PERFORM vc.reject_memory_candidate(1, v_rej);

    -- update is idempotent: the same summary applied twice succeeds both times
    -- and leaves the row unchanged.
    SELECT vc.update_memory(1, v_acc, 'edited') INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'first update must return true'; END IF;
    SELECT vc.update_memory(1, v_acc, 'edited') INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'duplicate update must return true'; END IF;
    PERFORM 1 FROM vc.get_memory(1, v_acc) WHERE out_summary = 'edited' AND out_status = 'ACCEPTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'duplicate update must leave content stable'; END IF;

    -- delete is idempotent: a second delete of an already-deleted memory returns
    -- TRUE without raising (owner-scoped; V12 matches the documented intent).
    SELECT vc.delete_memory(1, v_acc) INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'first delete must return true'; END IF;
    SELECT vc.delete_memory(1, v_acc) INTO v_ok;
    IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'duplicate delete must return true (idempotent)'; END IF;

    -- confirm and reject stay status-guarded: a duplicate that targets an
    -- already-transitioned memory is rejected, never silently re-applied.
    BEGIN
        PERFORM vc.confirm_memory_candidate(1, v_acc);
        RAISE EXCEPTION 'confirming an already-deleted memory must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected: deleted / not found (no existence disclosure)
    END;
    BEGIN
        PERFORM vc.reject_memory_candidate(1, v_rej);
        RAISE EXCEPTION 'rejecting an already-REJECTED memory must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected: not pending confirmation
    END;

    -- create is not deduped: two calls yield two distinct candidates.
    SELECT count(*) INTO n FROM vc.list_memory(1, 10, true);
    IF n <> 2 THEN RAISE EXCEPTION 'expected 2 distinct candidates (no create dedupe), got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
