-- 33_memory_cross_isolation_fail_closed: cross-user, cross-relationship and any
-- direct table access fail closed. list_memory scopes by relationship so one
-- relationship never sees another's memory; get/confirm/delete on a foreign id
-- never disclose existence; and the runtime role has no direct table access at
-- all (the functions are the only entry point).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
-- Owner 1 has two relationships (one active, one dormant) to exercise cross-rel.
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 11, 'persona-b', false);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE v_a bigint; v_b bigint;
BEGIN
    SELECT vc.create_memory_candidate(1, 10, 'RELATIONSHIP', 'rel-10-mem', NULL, ARRAY[]::text[]) INTO v_a;
    SELECT vc.create_memory_candidate(1, 11, 'RELATIONSHIP', 'rel-11-mem', NULL, ARRAY[]::text[]) INTO v_b;
    PERFORM vc.confirm_memory_candidate(1, v_a);
    PERFORM vc.confirm_memory_candidate(1, v_b);
    PERFORM set_config('app.mema', v_a::text, false);
    PERFORM set_config('app.memb', v_b::text, false);
END $$;
COMMIT;
RESET ROLE;

-- Cross-relationship: list_memory(1, 10) returns only relationship 10's memory.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.list_memory(1, 10, false);
    IF n <> 1 THEN RAISE EXCEPTION 'relationship 10 list must have 1 row, got %', n; END IF;
    PERFORM 1 FROM vc.list_memory(1, 10, false)
     WHERE out_id = current_setting('app.memb')::bigint;
    IF FOUND THEN RAISE EXCEPTION 'relationship 10 must not list relationship 11 memory'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Cross-user: owner 2 cannot read, confirm or delete owner 1's memory.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
BEGIN
    PERFORM 1 FROM vc.get_memory(2, current_setting('app.mema')::bigint);
    IF FOUND THEN RAISE EXCEPTION 'owner 2 must not read owner 1 memory'; END IF;

    BEGIN
        PERFORM vc.confirm_memory_candidate(2, current_setting('app.mema')::bigint);
        RAISE EXCEPTION 'cross-user confirm must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected: not found (existence hidden)
    END;

    BEGIN
        PERFORM vc.delete_memory(2, current_setting('app.mema')::bigint);
        RAISE EXCEPTION 'cross-user delete must fail';
    EXCEPTION WHEN OTHERS THEN
        -- expected: not found
    END;
END $$;
COMMIT;
RESET ROLE;

-- Direct table access by the runtime role is fully revoked, so no missing/wrong
-- context can bypass the relationship-scoped functions.
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM 1 FROM vc.memory_item;
        RAISE EXCEPTION 'direct SELECT on memory_item must be forbidden';
    EXCEPTION WHEN insufficient_privilege THEN
        -- expected: all access flows through the functions
    END;
    BEGIN
        PERFORM 1 FROM vc.memory_evidence;
        RAISE EXCEPTION 'direct SELECT on memory_evidence must be forbidden';
    EXCEPTION WHEN insufficient_privilege THEN
        -- expected
    END;
END $$;
RESET ROLE;
