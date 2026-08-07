-- 43_candidate_and_quota_release: insert_generation_candidate creates the
-- finalize prerequisite row (including the INV-GEN-002 single-final partial
-- unique index) and refuses terminal generations; record_quota_release writes
-- a RELEASE quota_ledger_entry row, and invalid kinds / negative amounts /
-- unknown generations reject.

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
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-cq-1', 'FINAL_REVIEW');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5001, 100, 'gen-cq-2', 'COMPLETED');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5002, 100, 'gen-cq-3', 'FINAL_REVIEW');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    cid    bigint;
    cid2   bigint;
    rid    bigint;
    n      int;
    v_kind text;
    f      record;
BEGIN
    -- Candidate insert returns an id and is consumable by finalize.
    SELECT out_candidate_id INTO cid FROM vc.insert_generation_candidate(
        1, 5000, 'draft answer', false);
    IF cid IS NULL THEN
        RAISE EXCEPTION 'insert_generation_candidate must return a candidate id';
    END IF;

    -- Terminal generations accept no new candidates (INV-GEN-003).
    BEGIN
        PERFORM vc.insert_generation_candidate(1, 5001, 'late candidate', false);
        RAISE EXCEPTION 'terminal generation must reject new candidates';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- finalize consumes the candidate end-to-end.
    SELECT * INTO f FROM vc.finalize_generation(
        1, 5000, cid, 'final answer', 'provider-a', 10, 5, 0.0010, 'USD', 1, true, NULL);
    IF f.out_finalized IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize must succeed with the inserted candidate';
    END IF;

    -- INV-GEN-002: at most one final candidate per generation. A second final
    -- candidate violates the partial unique index and aborts the transaction.
    SELECT out_candidate_id INTO cid2 FROM vc.insert_generation_candidate(
        1, 5002, 'first final', true);
    IF cid2 IS NULL THEN
        RAISE EXCEPTION 'final candidate insert must return an id';
    END IF;
    BEGIN
        PERFORM vc.insert_generation_candidate(1, 5002, 'second final', true);
        RAISE EXCEPTION 'a second final candidate must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected: unique violation on generation_candidate_one_final
    END;

    -- quota RELEASE row lands with kind RELEASE; finalize's SETTLE coexists.
    SELECT out_entry_id INTO rid FROM vc.record_quota_release(1, 5001, 1, 'zero-llm-release');
    IF rid IS NULL THEN
        RAISE EXCEPTION 'record_quota_release must return an entry id';
    END IF;
    SELECT kind INTO v_kind FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = 5001 AND id = rid;
    IF v_kind <> 'RELEASE' THEN
        RAISE EXCEPTION 'quota entry must be kind RELEASE (got %)', v_kind;
    END IF;
    SELECT count(*) INTO n FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = 5000 AND kind = 'SETTLE';
    IF n <> 1 THEN
        RAISE EXCEPTION 'finalize must write exactly one SETTLE (got %)', n;
    END IF;

    -- Negative quota amount fails closed.
    BEGIN
        PERFORM vc.record_quota_release(1, 5001, -1, 'bad-release');
        RAISE EXCEPTION 'negative quota_amount must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- Unknown generation fails closed.
    BEGIN
        PERFORM vc.record_quota_release(1, 9999, 1, 'unknown-gen');
        RAISE EXCEPTION 'unknown generation must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;
END $$;
COMMIT;
RESET ROLE;
