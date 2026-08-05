-- 01_cross_user_read_denied: a runtime role bound to owner 1 sees only owner 1's
-- rows; owner 2's rows are invisible under FORCE RLS (INV-TENANT-001).

\set ON_ERROR_STOP on

-- Isolate this test from any prior run by resetting all data as the migration
-- superuser before seeding (RLS does not bind superusers).
TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

-- Seed two owners and one relationship each, as the migration superuser (RLS
-- does not bind superusers, so seeding is unconditional).
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a'), (2, 20, 'persona-b');

-- Act as a NOBYPASSRLS runtime role with owner 1's tenant context.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 1 THEN
        RAISE EXCEPTION 'cross-user read leak: expected 1 row for owner 1, got %', n;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.relationship WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'cross-user read leak: owner 2 row visible to owner 1';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Re-verify the symmetric direction: owner 2 sees only its own row.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship;
    IF n <> 1 THEN
        RAISE EXCEPTION 'cross-user read leak: expected 1 row for owner 2, got %', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
