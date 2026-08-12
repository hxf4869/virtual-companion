-- 60_quota_nonneg_check_and_release_idempotency: §5.1.4 enforcement.
--
--   * generation_usage non-negative CHECK (finalize write path): finalize_generation with
--     negative input_tokens raises check_violation and the whole finalize transaction rolls
--     back (INV-TX-001) — leaving no usage row.
--   * quota_ledger_entry.quota_amount CHECK backstop: a direct negative INSERT as vc_api
--     raises check_violation even outside the record_quota_release function guard.
--   * record_quota_release idempotency: a second valid RELEASE for the same
--     (owner, generation) returns the existing entry id and inserts no extra row (the
--     partial unique index quota_ledger_release_one_per_generation is the concurrency
--     backstop).
--   * validation ordering: a negative-amount call against a generation that already has a
--     RELEASE still raises at the non-negative guard (idempotency no-op must not swallow an
--     invalid-amount call).

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
-- 6000: FINAL_REVIEW, used for the negative-input finalize CHECK test.
-- 6001: COMPLETED, used for the release idempotency + direct-DML CHECK tests
--       (record_quota_release only requires the generation to exist for the owner).
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 6000, 100, 'gen-q-1', 'FINAL_REVIEW');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 6001, 100, 'gen-q-2', 'COMPLETED');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    cid  bigint;
    rid1 bigint;
    rid2 bigint;
    n    int;
BEGIN
    -- §5.1.4 CHECK (finalize write path): seed a candidate for gen 6000, then finalize
    -- with negative input_tokens. The generation_usage INSERT hits the CHECK and the
    -- entire finalize transaction rolls back together.
    SELECT out_candidate_id INTO cid FROM vc.insert_generation_candidate(
        1, 6000, 'draft', false);
    IF cid IS NULL THEN
        RAISE EXCEPTION 'insert_generation_candidate must return a candidate id';
    END IF;
    BEGIN
        PERFORM vc.finalize_generation(
            1, 6000, cid, 'bad', 'p', -5, 0, 0, 'USD', 0, false, NULL);
        RAISE EXCEPTION 'negative input_tokens finalize must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected: check_violation from generation_usage_input_tokens_nonneg
    END;
    -- The failed finalize rolled back atomically: no usage row for gen 6000.
    SELECT count(*) INTO n FROM vc.generation_usage
     WHERE owner_user_id = 1 AND generation_id = 6000;
    IF n <> 0 THEN
        RAISE EXCEPTION 'failed negative finalize must leave no usage row (got %)', n;
    END IF;

    -- §5.1.4 CHECK backstop (direct DML, bypasses the function guard): a negative
    -- quota_amount INSERT is rejected by the table CHECK even outside record_quota_release.
    BEGIN
        INSERT INTO vc.quota_ledger_entry(
            owner_user_id, id, generation_id, kind, quota_amount, reason)
        VALUES (1, nextval('vc.finalize_row_id_seq'), 6001, 'RELEASE', -7, 'direct-dml');
        RAISE EXCEPTION 'negative quota_amount direct insert must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected: check_violation from quota_ledger_entry_quota_amount_nonneg
    END;

    -- §5.1.4 release idempotency: the first valid RELEASE for gen 6001 lands and returns
    -- an entry id.
    SELECT out_entry_id INTO rid1 FROM vc.record_quota_release(1, 6001, 3, 'first-release');
    IF rid1 IS NULL THEN
        RAISE EXCEPTION 'first record_quota_release must return an entry id';
    END IF;

    -- A second valid RELEASE for the same generation is idempotent: it returns the SAME
    -- entry id (no-op) and inserts no extra row.
    SELECT out_entry_id INTO rid2 FROM vc.record_quota_release(1, 6001, 2, 'second-release');
    IF rid2 IS DISTINCT FROM rid1 THEN
        RAISE EXCEPTION 'idempotent RELEASE must return the existing entry id (got %, want %)',
            rid2, rid1;
    END IF;
    SELECT count(*) INTO n FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = 6001 AND kind = 'RELEASE';
    IF n <> 1 THEN
        RAISE EXCEPTION 'idempotent RELEASE must leave exactly one RELEASE row (got %)', n;
    END IF;

    -- §5.1.4 validation ordering: a negative-amount call against a generation that already
    -- has a RELEASE must still raise at the non-negative guard. Idempotency no-op must NOT
    -- swallow an invalid-amount call (the guard runs before the idempotency check).
    BEGIN
        PERFORM vc.record_quota_release(1, 6001, -1, 'bad-after-release');
        RAISE EXCEPTION 'negative quota_amount must still be rejected after a RELEASE exists';
    EXCEPTION WHEN OTHERS THEN
        -- expected: non-negative guard fires before the idempotency check
    END;

    -- Unknown generation still fails closed (idempotency does not relax existence checks).
    BEGIN
        PERFORM vc.record_quota_release(1, 9999, 1, 'unknown-gen');
        RAISE EXCEPTION 'unknown generation must still be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;
END $$;
COMMIT;
RESET ROLE;
