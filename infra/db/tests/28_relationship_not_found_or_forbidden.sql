-- 28_relationship_not_found_or_forbidden: cross-owner reads never disclose
-- existence. get_relationship resolves only the caller's own relationship; a
-- foreign id returns nothing. activate_relationship on a foreign id raises. A
-- missing tenant context matches nothing (INV-TENANT-001 fail-closed).

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);

-- Owner 1 reads its own relationship but cannot see or act on owner 2's.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_hit boolean;
BEGIN
    -- Own relationship resolves.
    PERFORM 1 FROM vc.get_relationship(1, 10);
    IF NOT FOUND THEN RAISE EXCEPTION 'owner 1 must read its own relationship'; END IF;

    -- Foreign relationship resolves to nothing (existence never disclosed).
    PERFORM 1 FROM vc.get_relationship(1, 20);
    IF FOUND THEN RAISE EXCEPTION 'owner 1 must not see owner 2 relationship (existence disclosure)'; END IF;

    -- Activating a foreign relationship raises; the application maps this to
    -- NOT_FOUND_OR_FORBIDDEN. It must not reveal that id 20 belongs to owner 2.
    BEGIN
        PERFORM vc.activate_relationship(1, 20);
        RAISE EXCEPTION 'activating a foreign relationship must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%activating a foreign relationship must fail%' THEN
            RAISE;
        END IF;
        -- expected: not found (existence hidden)
    END;

    -- Deactivating a foreign relationship returns false (no row updated),
    -- again without disclosing that the id exists for another owner. Capture
    -- the boolean return value; PERFORM's FOUND only reflects row emission, not
    -- the function result.
    SELECT vc.deactivate_relationship(1, 20) INTO v_hit;
    IF v_hit IS DISTINCT FROM false THEN
        RAISE EXCEPTION 'deactivate on foreign id must report false, got %', v_hit;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A missing tenant context matches nothing on direct table access (fail closed).
-- The lifecycle functions establish context from their parameter, so the
-- fail-closed property is asserted at the table/RLS layer here.
SET ROLE vc_api;
BEGIN;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 0 THEN RAISE EXCEPTION 'missing tenant context must match no relationship (got %)', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 still sees exactly its own active Companion (unaffected by owner 1's
-- failed cross-owner attempts).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    PERFORM 1 FROM vc.get_relationship(2, 20);
    IF NOT FOUND THEN RAISE EXCEPTION 'owner 2 must read its own relationship'; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 must still have 1 active, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
