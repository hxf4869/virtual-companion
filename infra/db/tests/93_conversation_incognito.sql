-- 93_conversation_incognito: INC-MODE V38 — create_conversation freezes the
-- incognito flag chosen at creation time (default false for legacy 2-arg
-- callers), list_conversations returns out_incognito for the UI badge, and
-- the flag round-trips per owner (RLS isolation unchanged).

\set ON_ERROR_STOP on

TRUNCATE vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_incognito_conv bigint;
    v_normal_conv    bigint;
    v_inc_flag       boolean;
    v_norm_flag      boolean;
BEGIN
    -- Explicit incognito creation freezes the flag.
    v_incognito_conv := vc.create_conversation(1, 10, true);
    -- Legacy 2-arg call defaults to false.
    v_normal_conv := vc.create_conversation(1, 10);
    IF v_incognito_conv = v_normal_conv THEN
        RAISE EXCEPTION 'conversations must get distinct ids';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Round-trip through list_conversations (trusted-owner context required).
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_inc boolean;
    v_norm boolean;
    v_rows int;
BEGIN
    SELECT out_incognito INTO v_inc FROM vc.list_conversations(1, 10, 0, 100)
     ORDER BY out_id LIMIT 1;
    IF v_inc IS NOT TRUE THEN
        RAISE EXCEPTION 'first conversation must be incognito (got %)', v_inc;
    END IF;
    SELECT out_incognito INTO v_norm FROM vc.list_conversations(1, 10, 0, 100)
     ORDER BY out_id DESC LIMIT 1;
    IF v_norm IS NOT FALSE THEN
        RAISE EXCEPTION 'legacy conversation must default to non-incognito (got %)', v_norm;
    END IF;
END $$;
COMMIT;

-- Direct-write backstop: the flag column has a sane default.
DO $$
DECLARE
    v_flag boolean;
BEGIN
    SELECT incognito INTO v_flag FROM vc.conversation
     WHERE owner_user_id = 1 ORDER BY id DESC LIMIT 1;
    IF v_flag IS NOT FALSE THEN
        RAISE EXCEPTION 'default incognito must be false (got %)', v_flag;
    END IF;
END $$;
