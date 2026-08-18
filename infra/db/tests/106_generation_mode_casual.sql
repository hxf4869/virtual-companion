-- 106_generation_mode_casual: CHAT-MODE V51 — CASUAL is an approved mode
-- (FR-CHAT-002). First reception freezes CASUAL; a duplicate with LISTEN
-- does not rewrite it.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    r record;
    v_mode text;
BEGIN
    SELECT * INTO r FROM vc.receive_generation(1, 100, 'req-casual-1', 'user', 'hello', 'CASUAL');
    IF r.created IS NOT TRUE THEN
        RAISE EXCEPTION 'first reception must report created=true (got %)', r.created;
    END IF;
    SELECT mode INTO STRICT v_mode FROM vc.generation
     WHERE owner_user_id = 1 AND id = r.generation_id;
    IF v_mode IS DISTINCT FROM 'CASUAL' THEN
        RAISE EXCEPTION 'first reception must freeze CASUAL (got %)', v_mode;
    END IF;

    PERFORM * FROM vc.receive_generation(1, 100, 'req-casual-1', 'user', 'hello', 'LISTEN');
    SELECT mode INTO STRICT v_mode FROM vc.generation
     WHERE owner_user_id = 1 AND id = r.generation_id;
    IF v_mode IS DISTINCT FROM 'CASUAL' THEN
        RAISE EXCEPTION 'duplicate reception must keep CASUAL (got %)', v_mode;
    END IF;
END $$;
COMMIT;
RESET ROLE;
