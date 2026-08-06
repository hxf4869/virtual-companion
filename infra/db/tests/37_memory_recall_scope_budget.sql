-- 37_memory_recall_scope_budget: recall_memory returns only confirmed (ACCEPTED),
-- non-deleted memory for one owner and one relationship. RELATIONSHIP-scoped
-- memory is recalled across conversations; SESSION-scoped memory is recalled only
-- for the bound conversation. The result is budget-capped (clamped to [1,100]).
-- Cross-owner and cross-relationship recalls return no rows (existence hidden).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 11, 'persona-b', false);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'conv-100');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 101, 10, 'conv-101');

-- Seed owner 1 / relationship 10: two accepted RELATIONSHIP memories, a pending
-- and a rejected candidate (must never be recalled), two accepted SESSION
-- memories (one per conversation), plus one accepted RELATIONSHIP memory in
-- relationship 11 (cross-relationship) and one for owner 2 (cross-owner).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    v_r1 bigint; v_r2 bigint; v_sess100 bigint; v_sess101 bigint; v_rel11 bigint;
BEGIN
    SELECT vc.create_memory_candidate(1,10,'RELATIONSHIP','rel-1',NULL,ARRAY[]::text[]) INTO v_r1;
    SELECT vc.create_memory_candidate(1,10,'RELATIONSHIP','rel-2',NULL,ARRAY[]::text[]) INTO v_r2;
    PERFORM vc.confirm_memory_candidate(1,v_r1);
    PERFORM vc.confirm_memory_candidate(1,v_r2);
    -- pending + rejected candidates are never recalled.
    PERFORM vc.create_memory_candidate(1,10,'RELATIONSHIP','pending',NULL,ARRAY[]::text[]);
    PERFORM vc.reject_memory_candidate(1, vc.create_memory_candidate(1,10,'RELATIONSHIP','to-reject',NULL,ARRAY[]::text[]));
    -- accepted SESSION memories, one per conversation.
    SELECT vc.create_memory_candidate(1,10,'SESSION','sess-100',100,ARRAY[]::text[]) INTO v_sess100;
    SELECT vc.create_memory_candidate(1,10,'SESSION','sess-101',101,ARRAY[]::text[]) INTO v_sess101;
    PERFORM vc.confirm_memory_candidate(1,v_sess100);
    PERFORM vc.confirm_memory_candidate(1,v_sess101);
    -- accepted RELATIONSHIP memory in a different relationship (cross-rel).
    SELECT vc.create_memory_candidate(1,11,'RELATIONSHIP','rel-11',NULL,ARRAY[]::text[]) INTO v_rel11;
    PERFORM vc.confirm_memory_candidate(1,v_rel11);
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
BEGIN
    PERFORM vc.confirm_memory_candidate(2, vc.create_memory_candidate(2,20,'RELATIONSHIP','bob-rel',NULL,ARRAY[]::text[]));
END $$;
COMMIT;
RESET ROLE;

-- No conversation bound: only RELATIONSHIP memories for rel 10 (rel-1, rel-2);
-- SESSION excluded, pending/rejected excluded, cross-rel/owner excluded.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'recall rel-only must be 2, got %', n; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_summary = 'pending';
    IF FOUND THEN RAISE EXCEPTION 'pending candidate must never be recalled'; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_summary = 'to-reject';
    IF FOUND THEN RAISE EXCEPTION 'rejected candidate must never be recalled'; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_scope = 'SESSION';
    IF FOUND THEN RAISE EXCEPTION 'SESSION memory must not be recalled without a conversation'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Conversation 100 bound: RELATIONSHIP (rel-1, rel-2) + SESSION for conv 100
-- only (sess-100, not sess-101).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, 100, 50);
    IF n <> 3 THEN RAISE EXCEPTION 'recall conv-100 must be 3 (2 rel + 1 sess), got %', n; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, 100, 50) WHERE out_summary = 'sess-100';
    IF NOT FOUND THEN RAISE EXCEPTION 'sess-100 must be recalled for conv 100'; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, 100, 50) WHERE out_summary = 'sess-101';
    IF FOUND THEN RAISE EXCEPTION 'sess-101 must NOT be recalled for conv 100'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Budget cap: max_entries limits the result; a non-positive value clamps to 1.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 1);
    IF n <> 1 THEN RAISE EXCEPTION 'budget=1 must return 1, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 0);
    IF n <> 1 THEN RAISE EXCEPTION 'budget=0 must clamp to 1, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, -3);
    IF n <> 1 THEN RAISE EXCEPTION 'budget=-3 must clamp to 1, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Cross-owner and cross-relationship isolation: recall returns no rows and never
-- discloses existence.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.recall_memory(2, 10, NULL, 50);
    IF n <> 0 THEN RAISE EXCEPTION 'cross-owner recall must be empty, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.recall_memory(1, 11, NULL, 50);
    IF n <> 1 THEN RAISE EXCEPTION 'relationship 11 recall must be 1, got %', n; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 11, NULL, 50) WHERE out_summary = 'rel-1';
    IF FOUND THEN RAISE EXCEPTION 'relationship 11 must not recall relationship 10 memory'; END IF;
END $$;
COMMIT;
RESET ROLE;
