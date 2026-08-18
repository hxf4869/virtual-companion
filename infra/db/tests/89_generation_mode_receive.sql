-- 89_generation_mode_receive: CHAT-MODE V34 — the reception freezes the
-- turn-level interaction mode on the generation row; a duplicate reception with
-- a different mode never rewrites it (rejoin keeps the first reception's mode,
-- INV-GEN-001); unapproved modes normalize to AUTO as defense in depth; and the
-- CHECK constraint rejects a direct write of an unapproved mode.

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
    -- First reception with an explicit DISCUSS mode freezes DISCUSS.
    SELECT * INTO r FROM vc.receive_generation(1, 100, 'req-mode-1', 'user', 'hello', 'DISCUSS');
    IF r.created IS NOT TRUE THEN
        RAISE EXCEPTION 'first reception must report created=true (got %)', r.created;
    END IF;
    SELECT mode INTO STRICT v_mode FROM vc.generation
     WHERE owner_user_id = 1 AND id = r.generation_id;
    IF v_mode IS DISTINCT FROM 'DISCUSS' THEN
        RAISE EXCEPTION 'first reception must freeze DISCUSS (got %)', v_mode;
    END IF;

    -- Duplicate reception with a different mode must NOT rewrite the row.
    PERFORM * FROM vc.receive_generation(1, 100, 'req-mode-1', 'user', 'hello', 'LISTEN');
    SELECT mode INTO STRICT v_mode FROM vc.generation
     WHERE owner_user_id = 1 AND id = r.generation_id;
    IF v_mode IS DISTINCT FROM 'DISCUSS' THEN
        RAISE EXCEPTION 'duplicate reception must keep the first mode DISCUSS (got %)', v_mode;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Unapproved modes normalize to AUTO (SD defense in depth for direct callers).
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    r record;
    v_mode text;
BEGIN
    SELECT * INTO r FROM vc.receive_generation(1, 100, 'req-mode-2', 'user', 'hello', 'YELL');
    SELECT mode INTO STRICT v_mode FROM vc.generation
     WHERE owner_user_id = 1 AND id = r.generation_id;
    IF v_mode IS DISTINCT FROM 'AUTO' THEN
        RAISE EXCEPTION 'unapproved mode must normalize to AUTO (got %)', v_mode;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The CHECK constraint rejects a direct unapproved write (structural backstop).
DO $$
BEGIN
    BEGIN
        UPDATE vc.generation SET mode = 'YELL'
         WHERE owner_user_id = 1 AND id = (SELECT id FROM vc.generation
                                            WHERE owner_user_id = 1
                                              AND idempotency_key = 'req-mode-2');
        RAISE EXCEPTION 'unapproved direct mode write unexpectedly succeeded';
    EXCEPTION
        WHEN check_violation THEN
            -- expected: generation_mode_check fires
    END;
END $$;
