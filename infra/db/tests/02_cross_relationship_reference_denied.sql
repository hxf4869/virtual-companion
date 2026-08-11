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

-- TASK-0153 V16 note: direct INSERT on vc.conversation was revoked from
-- runtime roles. The composite ownership FK is a table-level constraint
-- enforced regardless of role (FKs are not bypassed by superuser), so the
-- cross-owner reference is now verified as the PostgreSQL superuser where
-- the INSERT reaches the FK check instead of being rejected at the privilege
-- check. A vc_api INSERT is now rejected with permission denied, which test
-- 52 covers explicitly.
DO $$
BEGIN
    -- owner_user_id 1, relationship_id 20 belongs to owner 2. The composite
    -- FK on (owner_user_id, relationship_id) must reject this insert.
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (1, 100, 20, 'should be rejected');
    RAISE EXCEPTION 'cross-relationship reference unexpectedly succeeded';
EXCEPTION
    WHEN foreign_key_violation THEN
        -- expected: composite ownership FK denied the cross-owner reference
END $$;
