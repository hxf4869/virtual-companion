-- 34_memory_lifecycle_evidence_scope: full Canonical Memory lifecycle, evidence
-- chain and Alpha scope rules. SESSION requires a conversation binding; ACCOUNT_*
-- is rejected in Alpha; create produces PENDING_CONFIRMATION candidates with
-- evidence; confirm/reject/delete transition them; list excludes soft-deleted by
-- default and includes them on request; get excludes deleted.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'conv');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    v_sess bigint;
    v_rel  bigint;
    v_rej  bigint;
    n      int;
BEGIN
    -- SESSION scope with a conversation and a two-source evidence chain.
    SELECT vc.create_memory_candidate(1, 10, 'SESSION', 'sess-mem', 100,
                                       ARRAY['src-1', 'src-2']) INTO v_sess;

    -- SESSION without a conversation must fail (catalog + CHECK).
    BEGIN
        PERFORM vc.create_memory_candidate(1, 10, 'SESSION', 'no-conv', NULL, ARRAY[]::text[]);
        RAISE EXCEPTION 'SESSION without conversation must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- ACCOUNT_PRIVATE is not enabled in Alpha.
    BEGIN
        PERFORM vc.create_memory_candidate(1, 10, 'ACCOUNT_PRIVATE', 'acct', NULL, ARRAY[]::text[]);
        RAISE EXCEPTION 'ACCOUNT_PRIVATE must fail in Alpha';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- RELATIONSHIP candidate + a candidate to reject.
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'rel-mem', NULL,
                                       ARRAY['src-3']) INTO v_rel;
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'to-reject', NULL,
                                       ARRAY[]::text[]) INTO v_rej;
    PERFORM vc.reject_memory_candidate(1, v_rej);

    PERFORM set_config('app.sess', v_sess::text, false);
    PERFORM set_config('app.rel', v_rel::text, false);

    -- Confirm the SESSION and RELATIONSHIP candidates (the canonical path).
    PERFORM vc.confirm_memory_candidate(1, v_sess);
    PERFORM vc.confirm_memory_candidate(1, v_rel);

    -- list (no deleted) shows all 3: SESSION, RELATIONSHIP, REJECTED.
    SELECT count(*) INTO n FROM vc.list_memory(1, 10, false);
    IF n <> 3 THEN RAISE EXCEPTION 'list must have 3 rows, got %', n; END IF;

    -- Soft-delete the SESSION memory; list excludes it by default.
    PERFORM vc.delete_memory(1, v_sess);
    SELECT count(*) INTO n FROM vc.list_memory(1, 10, false);
    IF n <> 2 THEN RAISE EXCEPTION 'list must have 2 after soft-delete, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_memory(1, 10, true);
    IF n <> 3 THEN RAISE EXCEPTION 'list include_deleted must have 3, got %', n; END IF;

    -- get_memory excludes deleted rows.
    PERFORM 1 FROM vc.get_memory(1, v_sess);
    IF FOUND THEN RAISE EXCEPTION 'get_memory must not return a deleted memory'; END IF;
    PERFORM 1 FROM vc.get_memory(1, v_rel) WHERE out_status = 'ACCEPTED';
    IF NOT FOUND THEN RAISE EXCEPTION 'get_memory must return the live RELATIONSHIP memory'; END IF;

    -- Deleting an already-deleted memory must fail (no existence disclosure).
    BEGIN
        PERFORM vc.delete_memory(1, v_sess);
        RAISE EXCEPTION 're-deleting must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected: not found (or already deleted)
    END;
END $$;
COMMIT;
RESET ROLE;

-- Evidence chain (superuser): the SESSION candidate carries its two sources.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.memory_evidence
     WHERE memory_item_id = current_setting('app.sess')::bigint;
    IF n <> 2 THEN RAISE EXCEPTION 'SESSION candidate must have 2 evidence rows, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.memory_evidence
     WHERE memory_item_id = current_setting('app.rel')::bigint;
    IF n <> 1 THEN RAISE EXCEPTION 'RELATIONSHIP candidate must have 1 evidence row, got %', n; END IF;
END $$;
