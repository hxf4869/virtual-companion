-- 26_relationship_active_limit_enforced: V2-W05 replaces the old single-active
-- limit with independent active instances. Creating a new instance does not
-- disable earlier ones; owner isolation and stable ST binding still hold.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');

-- Owner 1 creates two Companions; both stay active.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_a bigint;
    v_b bigint;
    n   int;
BEGIN
    SELECT vc.create_relationship(1, 'persona-a') INTO v_a;
    IF v_a IS NULL THEN RAISE EXCEPTION 'create must return an id'; END IF;

    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'expected 1 active after first create, got %', n; END IF;

    -- Second create preserves the first active instance.
    SELECT vc.create_relationship(1, 'persona-b') INTO v_b;
    IF v_b IS NULL THEN RAISE EXCEPTION 'second create must return an id'; END IF;

    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 2 THEN RAISE EXCEPTION 'expected 2 active after second create, got %', n; END IF;

    PERFORM 1 FROM vc.relationship WHERE id = v_a AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'first relationship must remain active after second create'; END IF;

    PERFORM 1 FROM vc.relationship WHERE id = v_b AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'second relationship must be active'; END IF;

    PERFORM set_config('app.va', v_a::text, false);
    PERFORM set_config('app.vb', v_b::text, false);
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 creates an independent active Companion; owner 1 is unaffected.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_c bigint;
    n   int;
BEGIN
    SELECT vc.create_relationship(2, 'persona-bob') INTO v_c;
    IF v_c IS NULL THEN RAISE EXCEPTION 'owner 2 create must return an id'; END IF;

    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 must have exactly 1 active, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 1 still has two active Companions after owner 2 acted.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.relationship WHERE active;
    IF n <> 2 THEN RAISE EXCEPTION 'owner 1 must still have 2 active, got %', n; END IF;

    -- Both relationships stay active.
    PERFORM 1 FROM vc.relationship
     WHERE id = current_setting('app.va')::bigint AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner 1 first relationship must remain active'; END IF;
    PERFORM 1 FROM vc.relationship
     WHERE id = current_setting('app.vb')::bigint AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'owner 1 second relationship must remain active'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- ST resolution uses the same Owner/RLS boundary, without direct DML grants.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc p, LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = 'vc.resolve_st_binding(bigint,text,text,text,bigint,text)'::regprocedure
                  AND a.grantee = 0 AND a.privilege_type = 'EXECUTE')
       OR has_function_privilege('vc_worker', 'vc.resolve_st_binding(bigint,text,text,text,bigint,text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'ST binding must only be executable by the API role';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(1, 'st1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'st1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    a record;
    b record;
    repeated record;
    branch record;
BEGIN
    SELECT * INTO a FROM vc.resolve_st_binding(1, 'st-chat-a', 'st-card', 'COMPANION', NULL, '澄夏');
    SELECT * INTO repeated FROM vc.resolve_st_binding(1, 'st-chat-a', 'st-card', 'COMPANION', NULL, '另一个名字');
    IF (a.out_relationship_id, a.out_conversation_id) IS DISTINCT FROM
       (repeated.out_relationship_id, repeated.out_conversation_id) THEN
        RAISE EXCEPTION 'same chat must preserve instance and conversation identities';
    END IF;
    SELECT * INTO b FROM vc.resolve_st_binding(1, 'st-chat-b', 'st-card', 'COMPANION', NULL, '澄夏');
    IF b.out_relationship_id = a.out_relationship_id THEN
        RAISE EXCEPTION 'same card in a new chat must create an independent instance';
    END IF;
    SELECT * INTO branch FROM vc.resolve_st_binding(1, 'st-branch-a', 'st-card', 'COMPANION', a.out_relationship_id, '');
    IF branch.out_relationship_id <> a.out_relationship_id OR branch.out_conversation_id = a.out_conversation_id THEN
        RAISE EXCEPTION 'explicit branch must reuse the instance, not the conversation';
    END IF;
    BEGIN
        PERFORM vc.resolve_st_binding(1, 'st-chat-a', 'other-card', 'COMPANION', NULL, '');
        RAISE EXCEPTION 'expected binding mismatch rejection';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'resolve_st_binding: conflict' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.resolve_st_binding(2, 'forged-owner', 'st-card', 'COMPANION', NULL, '');
        RAISE EXCEPTION 'expected trusted-owner rejection';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'resolve_st_binding: owner must match server-trusted context' THEN RAISE; END IF;
    END;
    PERFORM set_config('app.st_relationship', a.out_relationship_id::text, false);
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'st2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'st2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM vc.conversation WHERE st_chat_identity = 'st-chat-a') THEN
        RAISE EXCEPTION 'foreign ST binding leaked through RLS';
    END IF;
    BEGIN
        PERFORM vc.resolve_st_binding(2, 'foreign-branch', 'st-card', 'COMPANION', current_setting('app.st_relationship')::bigint, '');
        RAISE EXCEPTION 'expected foreign instance rejection';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'resolve_st_binding: relationship not found' THEN RAISE; END IF;
    END;
    -- The same chat spelling is independent under a different Owner.
    PERFORM vc.resolve_st_binding(2, 'st-chat-a', 'st-card', 'COMPANION', NULL, '');
END $$;
COMMIT;
RESET ROLE;
