-- 13_idempotent_receive_same_generation_id: a retried reception with the same
-- owner + idempotency_key resolves to the SAME logical_generation_id and the
-- same generation row, reports created=false, and returns no message id; the
-- first reception reports created=true (INV-GEN-001).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');

-- receive_generation is granted to vc_api (V6 revokes PUBLIC EXECUTE). It binds
-- vc.owner_user_id for the transaction, so later reads stay scoped to owner 1.
SET ROLE vc_api;
BEGIN;
DO $$
DECLARE
    v_logical1 text;
    v_gen1     bigint;
    v_msg1     bigint;
    v_created1 boolean;
    v_logical2 text;
    v_gen2     bigint;
    v_msg2     bigint;
    v_created2 boolean;
BEGIN
    SELECT logical_generation_id, generation_id, message_id, created
      INTO v_logical1, v_gen1, v_msg1, v_created1
      FROM vc.receive_generation(1, 100, 'req-1', 'user', 'hello');

    IF v_created1 IS NOT TRUE THEN
        RAISE EXCEPTION 'first reception must report created=true (got %)', v_created1;
    END IF;
    IF v_logical1 IS NULL OR v_logical1 = '' THEN
        RAISE EXCEPTION 'first reception must return a logical_generation_id';
    END IF;
    IF v_msg1 IS NULL THEN
        RAISE EXCEPTION 'first reception must create a user message';
    END IF;

    -- Retry the same logical request with the same owner + idempotency key.
    SELECT logical_generation_id, generation_id, message_id, created
      INTO v_logical2, v_gen2, v_msg2, v_created2
      FROM vc.receive_generation(1, 100, 'req-1', 'user', 'hello-again');

    IF v_created2 IS NOT FALSE THEN
        RAISE EXCEPTION 'duplicate reception must report created=false (got %)', v_created2;
    END IF;
    IF v_logical2 IS DISTINCT FROM v_logical1 THEN
        RAISE EXCEPTION 'duplicate reception returned a different logical_generation_id: % vs %',
            v_logical2, v_logical1;
    END IF;
    IF v_gen2 IS DISTINCT FROM v_gen1 THEN
        RAISE EXCEPTION 'duplicate reception resolved a different generation row';
    END IF;
    IF v_msg2 IS NOT NULL THEN
        RAISE EXCEPTION 'duplicate reception must not return a message id (got %)', v_msg2;
    END IF;
END $$;
COMMIT;
RESET ROLE;
