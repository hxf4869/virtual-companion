-- 176_st_character_conversation_bindings: V141 edge acceptance, complementing
-- 26's basic binding matrix (retry reuse, independent instances, branches,
-- cross-owner isolation, forged owner, grant metadata). Here only: mode and
-- explicit-relationship switches on a bound chat are rejected as conflicts
-- without leaving orphan rows; a call with no trusted-owner context is
-- rejected; and a real vc_worker session is denied execution.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- Unset trusted-owner context must reject. Kept first so no earlier
-- set_owner_context can leak into this session.
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rejected boolean := false;
BEGIN
    BEGIN
        PERFORM vc.resolve_st_binding(1, 'st-unset-chat', 'st-card', 'COMPANION', NULL, '');
    EXCEPTION WHEN OTHERS THEN
        -- 拒绝即达标：未设上下文时 current_owner_id 的具体失败形态不在此钉死
        v_rejected := true;
    END;
    IF NOT v_rejected THEN
        RAISE EXCEPTION 'resolve without trusted owner context must be rejected';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Seeded bindings (necessary seed only): chats A and B share one card and
-- mode, so a rejection below can only come from the switched parameter.
BEGIN;
SELECT vc.set_owner_context(1, 'b1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    a      record;
    b      record;
    n_rel  int;
    n_conv int;
BEGIN
    SELECT * INTO a FROM vc.resolve_st_binding(1, 'st-chat-a', 'st-card', 'COMPANION', NULL, '');
    SELECT * INTO b FROM vc.resolve_st_binding(1, 'st-chat-b', 'st-card', 'COMPANION', NULL, '');
    IF a.out_relationship_id IS NULL OR b.out_relationship_id IS NULL
       OR b.out_relationship_id = a.out_relationship_id THEN
        RAISE EXCEPTION 'seeding must produce two distinct instances';
    END IF;

    SELECT count(*) INTO n_rel FROM vc.relationship;
    SELECT count(*) INTO n_conv FROM vc.conversation;
    BEGIN
        PERFORM vc.resolve_st_binding(1, 'st-chat-a', 'st-card', 'STORY', NULL, '');
        RAISE EXCEPTION 'mode switch on a bound chat must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'resolve_st_binding: conflict' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.resolve_st_binding(1, 'st-chat-a', 'st-card', 'COMPANION', b.out_relationship_id, '');
        RAISE EXCEPTION 'mismatched explicit relationship on a bound chat must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'resolve_st_binding: conflict' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.resolve_st_binding(1, ' ', 'st-card', 'COMPANION', NULL, '');
        RAISE EXCEPTION 'blank chat identity must be rejected';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    IF (SELECT count(*) FROM vc.relationship) <> n_rel
       OR (SELECT count(*) FROM vc.conversation) <> n_conv THEN
        RAISE EXCEPTION 'rejected resolutions must not leave orphan rows';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A real vc_worker session is denied execution (26 checks grant metadata;
-- this exercises the server-side denial itself).
BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        PERFORM vc.resolve_st_binding(1, 'st-worker-chat', 'st-card', 'COMPANION', NULL, '');
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_worker execution must be denied';
    END IF;
END $$;
COMMIT;
RESET ROLE;
