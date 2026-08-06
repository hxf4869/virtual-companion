-- 27_relationship_unique_index_guard: the partial unique index
-- relationship_one_active_per_owner is the structural authority for
-- activeCompanionLimit=1. Probed directly (bypassing the lifecycle functions) it
-- rejects a second ACTIVE row for the same owner, leaves a different owner
-- independent, and never conflicts with a dormant (active=false) row.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');

-- Direct INSERTs run as the migration owner (superuser) so they exercise the
-- index itself, not the SECURITY DEFINER lifecycle. RLS is irrelevant to a
-- unique index; the constraint fires regardless of role.
DO $$
BEGIN
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (1, 101, 'persona-a', true);

    -- A second ACTIVE row for the same owner must violate the partial index.
    BEGIN
        INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
        VALUES (1, 102, 'persona-b', true);
        RAISE EXCEPTION 'second active relationship for owner 1 was accepted';
    EXCEPTION WHEN unique_violation THEN
        -- expected: relationship_one_active_per_owner rejected it
    END;

    -- A different owner may hold their own active Companion independently.
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (2, 201, 'persona-bob', true);

    -- A dormant relationship never conflicts (partial index is WHERE active).
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (1, 103, 'persona-c', false);
END $$;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 1 AND active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must have exactly 1 active, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 1 AND active = false;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must have 1 dormant, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 2 AND active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 must have 1 active, got %', n; END IF;
END $$;
