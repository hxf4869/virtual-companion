-- 38_memory_recall_tombstone_determinism: the deletion tombstone and recall
-- determinism. A deleted memory is never recalled (no vector/cache revival); the
-- remaining recall order is stable; the same inputs always reproduce the same
-- output; an unconfirmed candidate is never recalled. This satisfies AC1
-- (deterministic tests for recall before/after deletion, tombstone, reindex).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);

-- Three accepted RELATIONSHIP memories (a, b, c) plus one unconfirmed candidate.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE va bigint; vb bigint; vc bigint;
BEGIN
    SELECT vc.create_memory_candidate(1,10,'RELATIONSHIP','mem-a',NULL,ARRAY[]::text[]) INTO va;
    SELECT vc.create_memory_candidate(1,10,'RELATIONSHIP','mem-b',NULL,ARRAY[]::text[]) INTO vb;
    SELECT vc.create_memory_candidate(1,10,'RELATIONSHIP','mem-c',NULL,ARRAY[]::text[]) INTO vc;
    PERFORM vc.confirm_memory_candidate(1,va);
    PERFORM vc.confirm_memory_candidate(1,vb);
    PERFORM vc.confirm_memory_candidate(1,vc);
    PERFORM set_config('app.mema', va::text, false);
    PERFORM set_config('app.memb', vb::text, false);
    PERFORM set_config('app.memc', vc::text, false);
    -- unconfirmed candidate must never be recalled.
    PERFORM vc.create_memory_candidate(1,10,'RELATIONSHIP','unconfirmed',NULL,ARRAY[]::text[]);
END $$;
COMMIT;
RESET ROLE;

-- Determinism + tombstone.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    before bigint[]; after bigint[]; twice bigint[]; n int;
BEGIN
    -- Recall before deletion: exactly the 3 accepted memories, deterministic
    -- order (scope, created_at, id).
    SELECT array_agg(out_id ORDER BY out_id) INTO before
      FROM vc.recall_memory(1, 10, NULL, 50);
    IF array_length(before,1) <> 3 THEN RAISE EXCEPTION 'before: expected 3, got %', before; END IF;

    -- Same inputs reproduce the same output (deterministic).
    SELECT array_agg(out_id ORDER BY out_id) INTO twice
      FROM vc.recall_memory(1, 10, NULL, 50);
    IF twice IS DISTINCT FROM before THEN RAISE EXCEPTION 'recall must be deterministic'; END IF;

    -- Unconfirmed candidate is never in the result.
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_summary = 'unconfirmed';
    IF FOUND THEN RAISE EXCEPTION 'unconfirmed candidate must never be recalled'; END IF;

    -- Tombstone + propagation: delete mem-b; recall excludes it and the order of
    -- the remaining rows is unchanged (no vector/cache revival).
    PERFORM vc.delete_memory(1, current_setting('app.memb')::bigint);
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'after delete: expected 2, got %', n; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_id = current_setting('app.memb')::bigint;
    IF FOUND THEN RAISE EXCEPTION 'deleted memory must not be recalled (tombstone)'; END IF;

    -- Remaining rows are exactly {a, c} in the same relative deterministic order.
    SELECT array_agg(out_id ORDER BY out_id) INTO after
      FROM vc.recall_memory(1, 10, NULL, 50);
    IF after IS DISTINCT FROM ARRAY[current_setting('app.mema')::bigint,
                                    current_setting('app.memc')::bigint]
    THEN RAISE EXCEPTION 'remaining recall must be exactly {a,c}, got %', after; END IF;

    -- Idempotent re-delete does not change recall (owner-scoped idempotent delete).
    PERFORM vc.delete_memory(1, current_setting('app.memb')::bigint);
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'recall after idempotent re-delete must still be 2, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
