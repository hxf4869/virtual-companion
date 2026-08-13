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

-- TASK-0153 V16 note: direct INSERT on vc.generation was revoked from runtime
-- roles. The first DO block (direct INSERT FK check) now runs as the PostgreSQL
-- superuser so the INSERT reaches the composite FK. The second DO block calls
-- the SECURITY DEFINER receive_generation function, which is unaffected by the
-- V16 REVOKE (it runs with definer privileges), so it keeps SET ROLE vc_api to
-- prove the function cannot escape the FK even when invoked by a runtime role.

-- Direct-insert FK check (superuser path).
DO $$
BEGIN
    -- owner_user_id 1, conversation 200 belongs to owner 2; the composite FK
    -- rejects the cross-owner reference.
    INSERT INTO vc.generation(owner_user_id, id, conversation_id,
                              logical_generation_id, status, idempotency_key)
    VALUES (1, 1000, 200, 'gen-x', 'CREATED', 'req-x');
    RAISE EXCEPTION 'cross-owner generation reference unexpectedly succeeded';
EXCEPTION
    WHEN foreign_key_violation THEN
        -- expected: composite ownership FK denied the cross-owner reference
END $$;

-- SECURITY DEFINER function FK check (vc_api path).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
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
