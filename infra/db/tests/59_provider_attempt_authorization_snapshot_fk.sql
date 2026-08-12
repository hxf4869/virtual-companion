-- 59_provider_attempt_authorization_snapshot_fk: INV-AUTH-001 DB enforcement
-- (TASK-0164). provider_attempt now binds requested + execution authorization
-- snapshots via two composite FKs to authorization_snapshot(owner_user_id,
-- snapshot_id). This test carries the integration_test leg of INV-AUTH-001:
--   * positive      : a valid owner-scoped snapshot pair is accepted + round-trips
--   * negative A    : an unknown snapshot_id is rejected (foreign_key_violation)
--   * negative B    : a cross-owner snapshot is rejected (composite FK owner part)

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-inv-1', 'IN_PROGRESS');

-- Owner 1 owns req/exec snapshots; owner 2 owns a distinct pair (to prove the
-- composite FK owner_user_id component forbids cross-owner borrowing).
INSERT INTO vc.authorization_snapshot(
    owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
    purpose, data_categories)
VALUES
    (1, 'req-snap-1', 'ACTIVE', 'provider-1', 'us-east-1', 'standard', 'chat', ARRAY['text']),
    (1, 'exec-snap-1', 'ACTIVE', 'provider-1', 'us-east-1', 'standard', 'chat', ARRAY['text']),
    (2, 'snap-2-req', 'ACTIVE', 'provider-1', 'us-east-1', 'standard', 'chat', ARRAY['text']),
    (2, 'snap-2-exec', 'ACTIVE', 'provider-1', 'us-east-1', 'standard', 'chat', ARRAY['text']);

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    r record;
    n int;
BEGIN
    -- Positive: owner-scoped snapshots are accepted and round-trip.
    SELECT * INTO r FROM vc.record_provider_attempt(
        1, 5000, 'provider-1', 'openai', 'SUCCEEDED', 'req-snap-1', 'exec-snap-1');
    IF r.out_id IS NULL OR r.out_owner_user_id <> 1 THEN
        RAISE EXCEPTION 'positive case must return id and owner';
    END IF;
    SELECT count(*) INTO n FROM vc.provider_attempt
     WHERE requested_authorization_snapshot = 'req-snap-1'
       AND execution_authorization_snapshot = 'exec-snap-1';
    IF n <> 1 THEN
        RAISE EXCEPTION 'snapshot binding must round-trip (got %)', n;
    END IF;

    -- Negative A: an unknown snapshot_id is rejected by the composite FK.
    BEGIN
        PERFORM * FROM vc.record_provider_attempt(
            1, 5000, 'provider-1', 'openai', 'SUCCEEDED', 'does-not-exist', 'exec-snap-1');
        RAISE EXCEPTION 'unknown requested snapshot must be rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- expected: composite FK (owner_user_id, snapshot_id) miss
    END;

    -- Negative B: a cross-owner snapshot is rejected. Owner 1 borrows owner 2's
    -- snapshot_id; the composite FK owner_user_id component fails even though
    -- 'snap-2-req' exists in authorization_snapshot (for owner 2).
    BEGIN
        PERFORM * FROM vc.record_provider_attempt(
            1, 5000, 'provider-1', 'openai', 'SUCCEEDED', 'snap-2-req', 'snap-2-exec');
        RAISE EXCEPTION 'cross-owner snapshot borrowing must be rejected';
    EXCEPTION WHEN foreign_key_violation THEN
        -- expected: composite FK owner mismatch
    END;

    -- No stray rows from the rejected inserts.
    SELECT count(*) INTO n FROM vc.provider_attempt;
    IF n <> 1 THEN
        RAISE EXCEPTION 'only the positive row must remain (got %)', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
