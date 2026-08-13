-- 38_memory_recall_tombstone_determinism: the deletion tombstone and recall
-- determinism. A deleted memory is never recalled (no vector/cache revival); the
-- remaining recall ORDER is stable (AC1: "顺序不变"); the same inputs always
-- reproduce the same ordered output; an unconfirmed candidate is never recalled.
--
-- The array captures use WITH ORDINALITY so the rows are aggregated IN THE
-- FUNCTION'S OWN OUTPUT ORDER (scope, created_at, id) -- not re-sorted by id --
-- so the test pins the deterministic order that budget truncation relies on.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);

-- Three accepted RELATIONSHIP memories (a, b, c) plus one unconfirmed candidate.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
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

-- Determinism + tombstone + order stability.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    va bigint := current_setting('app.mema')::bigint;
    vb bigint := current_setting('app.memb')::bigint;
    vc bigint := current_setting('app.memc')::bigint;
    before bigint[]; after bigint[]; twice bigint[]; n int;
BEGIN
    -- Capture rows IN THE FUNCTION'S OWN ORDER via WITH ORDINALITY, so the order
    -- (not just the set) is asserted. Expected: [va, vb, vc] (all RELATIONSHIP,
    -- same tx created_at, id ascending).
    SELECT array_agg(out_id ORDER BY ord) INTO before
      FROM vc.recall_memory(1, 10, NULL, 50)
      WITH ORDINALITY AS r(out_id, out_scope, out_summary, out_conversation_id, out_created_at, ord);
    IF before IS DISTINCT FROM ARRAY[va, vb, vc] THEN
        RAISE EXCEPTION 'before: recall must be [va,vb,vc] in function order, got %', before;
    END IF;

    -- Determinism: same inputs reproduce the same ordered output.
    SELECT array_agg(out_id ORDER BY ord) INTO twice
      FROM vc.recall_memory(1, 10, NULL, 50)
      WITH ORDINALITY AS r(out_id, out_scope, out_summary, out_conversation_id, out_created_at, ord);
    IF twice IS DISTINCT FROM before THEN RAISE EXCEPTION 'recall must be deterministic (ordered)'; END IF;

    -- Unconfirmed candidate is never in the result.
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_summary = 'unconfirmed';
    IF FOUND THEN RAISE EXCEPTION 'unconfirmed candidate must never be recalled'; END IF;

    -- Tombstone + propagation: delete vb; recall excludes it and the remaining
    -- ORDER is unchanged (no vector/cache revival).
    PERFORM vc.delete_memory(1, vb);
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'after delete: expected 2, got %', n; END IF;
    PERFORM 1 FROM vc.recall_memory(1, 10, NULL, 50) WHERE out_id = vb;
    IF FOUND THEN RAISE EXCEPTION 'deleted memory must not be recalled (tombstone)'; END IF;
    SELECT array_agg(out_id ORDER BY ord) INTO after
      FROM vc.recall_memory(1, 10, NULL, 50)
      WITH ORDINALITY AS r(out_id, out_scope, out_summary, out_conversation_id, out_created_at, ord);
    IF after IS DISTINCT FROM ARRAY[va, vc] THEN
        RAISE EXCEPTION 'remaining recall must be [va,vc] in function order, got %', after;
    END IF;

    -- Idempotent re-delete does not change recall (owner-scoped idempotent delete).
    PERFORM vc.delete_memory(1, vb);
    SELECT count(*) INTO n FROM vc.recall_memory(1, 10, NULL, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'recall after idempotent re-delete must still be 2, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
