-- 14_idempotent_receive_no_duplicate_message: a duplicate reception creates no
-- second user message. Only the first reception writes the user message, and its
-- content is preserved across retries. A NULL idempotency key always mints a
-- fresh generation (and message), proving the partial index ignores NULL keys.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');

SET ROLE vc_api;
BEGIN;
-- V17: receive_generation now requires a server-trusted owner context (P1-04).
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    r        record;
    n        int;
    n_gen    int;
BEGIN
    SELECT * INTO r FROM vc.receive_generation(1, 100, 'req-1', 'user', 'first');
    -- Two retries with the same key: neither may create a second message.
    SELECT * INTO r FROM vc.receive_generation(1, 100, 'req-1', 'user', 'first-dup');
    SELECT * INTO r FROM vc.receive_generation(1, 100, 'req-1', 'user', 'first-dup-2');

    SELECT count(*) INTO n
      FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 100;
    IF n <> 1 THEN
        RAISE EXCEPTION 'duplicate reception created % user messages, expected 1', n;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM vc.message
         WHERE owner_user_id = 1 AND conversation_id = 100 AND content = 'first'
    ) THEN
        RAISE EXCEPTION 'first-reception user message content was not preserved';
    END IF;

    -- Exactly one generation row for this idempotency key.
    SELECT count(*) INTO n_gen
      FROM vc.generation
     WHERE owner_user_id = 1 AND conversation_id = 100 AND idempotency_key = 'req-1';
    IF n_gen <> 1 THEN
        RAISE EXCEPTION 'expected 1 generation for req-1, got %', n_gen;
    END IF;

    -- A NULL idempotency key is not deduped: each call mints a fresh generation.
    SELECT * INTO r FROM vc.receive_generation(1, 100, NULL, 'user', 'no-key-a');
    SELECT * INTO r FROM vc.receive_generation(1, 100, NULL, 'user', 'no-key-b');

    SELECT count(*) INTO n
      FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 100;
    IF n <> 3 THEN
        RAISE EXCEPTION 'NULL-key receptions should add 2 messages (1 keyed + 2 no-key), got % total', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
