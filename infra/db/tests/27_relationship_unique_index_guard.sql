-- V2-W05: V141 removes the former single-active index. Direct inserts must
-- permit multiple active CharacterInstances while leaving owners independent.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');

-- Direct INSERTs run as the migration owner (superuser) so they exercise the
-- structure itself, not the SECURITY DEFINER lifecycle.
DO $$
BEGIN
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (1, 101, 'persona-a', true);

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (1, 102, 'persona-b', true);

    -- A different owner may hold their own active Companion independently.
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (2, 201, 'persona-bob', true);

    -- Dormant instances remain distinct from the active instances.
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (1, 103, 'persona-c', false);
END $$;

DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 1 AND active;
    IF n <> 2 THEN RAISE EXCEPTION 'owner 1 must have exactly 2 active, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 1 AND active = false;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must have 1 dormant, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 2 AND active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 must have 1 active, got %', n; END IF;
    IF to_regclass('vc.relationship_one_active_per_owner') IS NOT NULL THEN
        RAISE EXCEPTION 'the obsolete single-active index must be removed by V141';
    END IF;
END $$;
