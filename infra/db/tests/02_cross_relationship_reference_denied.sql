-- 02_cross_relationship_reference_denied: a conversation owned by user 1 cannot
-- reference a relationship owned by user 2. The composite ownership foreign key
-- (owner_user_id, relationship_id) rejects the cross-owner reference even when
-- the RLS WITH CHECK would otherwise pass.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a'), (2, 20, 'persona-b');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
BEGIN
    -- owner_user_id matches the active context (so RLS WITH CHECK passes),
    -- but relationship_id 20 belongs to owner 2. The composite FK on
    -- (owner_user_id, relationship_id) must reject this insert.
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (1, 100, 20, 'should be rejected');
    RAISE EXCEPTION 'cross-relationship reference unexpectedly succeeded';
EXCEPTION
    WHEN foreign_key_violation THEN
        -- expected: composite ownership FK denied the cross-owner reference
END $$;
COMMIT;
RESET ROLE;
