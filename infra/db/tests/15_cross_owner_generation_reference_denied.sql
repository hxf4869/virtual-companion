-- 15_cross_owner_generation_reference_denied: a generation owned by user 1
-- cannot reference a conversation owned by user 2. The composite ownership FK
-- vc.generation(owner_user_id, conversation_id) -> vc.conversation(owner_user_id,
-- id) denies the cross-owner reference on direct insert AND through the
-- SECURITY DEFINER receive_generation function, which cannot escape the FK.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref)
VALUES (1, 10, 'persona-a'), (2, 20, 'persona-b');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv'), (2, 200, 20, 'bob-conv');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE r record;
BEGIN
    -- Direct insert: owner matches context, but conversation 200 belongs to
    -- owner 2; the composite FK rejects the cross-owner reference.
    INSERT INTO vc.generation(owner_user_id, id, conversation_id,
                              logical_generation_id, status, idempotency_key)
    VALUES (1, 1000, 200, 'gen-x', 'CREATED', 'req-x');
    RAISE EXCEPTION 'cross-owner generation reference unexpectedly succeeded';
EXCEPTION
    WHEN foreign_key_violation THEN
        -- expected: composite ownership FK denied the cross-owner reference
END $$;

DO $$
DECLARE r record;
BEGIN
    -- The SECURITY DEFINER receive function cannot escape the composite FK
    -- either: pointing owner 1 at conversation 200 (owner 2) is rejected.
    SELECT * INTO r FROM vc.receive_generation(1, 200, 'req-y', 'user', 'rejected');
    RAISE EXCEPTION 'receive_generation cross-owner reference unexpectedly succeeded';
EXCEPTION
    WHEN foreign_key_violation THEN
        -- expected: the function's insert is bound by the same composite FK
END $$;
COMMIT;
RESET ROLE;
