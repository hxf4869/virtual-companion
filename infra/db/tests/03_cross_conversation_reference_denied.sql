-- 03_cross_conversation_reference_denied: a message owned by user 1 cannot
-- reference a conversation owned by user 2. The composite ownership chain
-- user -> relationship -> conversation -> message holds at every hop.

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
BEGIN
    -- owner_user_id matches context, but conversation_id 200 belongs to owner 2.
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (1, 1000, 200, 'user', 'should be rejected');
    RAISE EXCEPTION 'cross-conversation reference unexpectedly succeeded';
EXCEPTION
    WHEN foreign_key_violation THEN
        -- expected: composite ownership FK denied the cross-owner reference
END $$;
COMMIT;
RESET ROLE;
