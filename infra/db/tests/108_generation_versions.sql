-- 108_generation_versions: GEN-VER V53 — regenerate reuses the user message,
-- history defaults to the selected assistant version, select flips visibility.
--
-- Covers: first receive stamps source_user_message_id; regenerate does not
-- insert a second user row; selected moves to the new generation; list_messages
-- hides the unselected assistant; select_generation_version restores it;
-- idempotent regenerate does not create a third generation; foreign source
-- fail-closed; vc_worker cannot list versions.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    r1 record;
    r2 record;
    r3 record;
    v_source bigint;
    v_users int;
    v_assist int;
    v_sel boolean;
    n int;
BEGIN
    SELECT * INTO r1 FROM vc.receive_generation(1, 100, 'ver-1', 'user', 'hello', 'AUTO');
    IF r1.created IS NOT TRUE OR r1.message_id IS NULL THEN
        RAISE EXCEPTION 'first receive must create a user message';
    END IF;
    SELECT source_user_message_id INTO v_source
      FROM vc.generation WHERE owner_user_id = 1 AND id = r1.generation_id;
    IF v_source IS DISTINCT FROM r1.message_id THEN
        RAISE EXCEPTION 'first receive must stamp source_user_message_id, got %', v_source;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Superuser writes the first assistant row (runtime DML is revoked for vc_api).
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, generation_id)
SELECT 1, nextval('vc.message_id_seq'), 100, 'assistant', 'answer-v1', g.id
  FROM vc.generation g
 WHERE g.owner_user_id = 1 AND g.idempotency_key = 'ver-1';

BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    r1 record;
    r2 record;
    v_users int;
    v_sel boolean;
    n int;
    v_source bigint;
BEGIN
    SELECT id, source_user_message_id INTO r1
      FROM vc.generation WHERE owner_user_id = 1 AND idempotency_key = 'ver-1';
    v_source := r1.source_user_message_id;

    SELECT * INTO r2 FROM vc.receive_generation(
        1, 100, 'ver-2', 'user', 'hello', 'AUTO', v_source);
    IF r2.created IS NOT TRUE THEN
        RAISE EXCEPTION 'regenerate must create a new generation';
    END IF;
    IF r2.message_id IS DISTINCT FROM v_source THEN
        RAISE EXCEPTION 'regenerate must reuse the source user message, got %', r2.message_id;
    END IF;
    SELECT count(*) INTO v_users FROM vc.message
     WHERE owner_user_id = 1 AND conversation_id = 100 AND role = 'user';
    IF v_users <> 1 THEN
        RAISE EXCEPTION 'regenerate must not insert a second user message, got %', v_users;
    END IF;

    SELECT selected INTO v_sel FROM vc.generation WHERE owner_user_id = 1 AND id = r1.id;
    IF v_sel IS NOT FALSE THEN
        RAISE EXCEPTION 'first generation must be unselected after regenerate';
    END IF;
    SELECT selected INTO v_sel FROM vc.generation WHERE owner_user_id = 1 AND id = r2.generation_id;
    IF v_sel IS NOT TRUE THEN
        RAISE EXCEPTION 'new generation must be selected';
    END IF;
END $$;
COMMIT;
RESET ROLE;

INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content, generation_id)
SELECT 1, nextval('vc.message_id_seq'), 100, 'assistant', 'answer-v2', g.id
  FROM vc.generation g
 WHERE g.owner_user_id = 1 AND g.idempotency_key = 'ver-2';

BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    v_content text;
    v_gen1 bigint;
    v_gen2 bigint;
    ok boolean;
BEGIN
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 0, 50);
    IF n <> 2 THEN
        RAISE EXCEPTION 'history must show user + selected assistant only, got %', n;
    END IF;
    SELECT out_content INTO v_content
      FROM vc.list_messages(1, 100, 0, 50)
     WHERE out_role = 'assistant';
    IF v_content IS DISTINCT FROM 'answer-v2' THEN
        RAISE EXCEPTION 'default history must show selected v2, got %', v_content;
    END IF;

    SELECT id INTO v_gen1 FROM vc.generation
     WHERE owner_user_id = 1 AND idempotency_key = 'ver-1';
    SELECT id INTO v_gen2 FROM vc.generation
     WHERE owner_user_id = 1 AND idempotency_key = 'ver-2';

    SELECT count(*) INTO n FROM vc.list_generation_versions(
        1, (SELECT source_user_message_id FROM vc.generation WHERE id = v_gen1 AND owner_user_id = 1));
    IF n <> 2 THEN
        RAISE EXCEPTION 'must list two versions, got %', n;
    END IF;

    SELECT vc.select_generation_version(1, v_gen1) INTO ok;
    IF ok IS NOT TRUE THEN
        RAISE EXCEPTION 'select v1 must succeed';
    END IF;
    SELECT out_content INTO v_content
      FROM vc.list_messages(1, 100, 0, 50)
     WHERE out_role = 'assistant';
    IF v_content IS DISTINCT FROM 'answer-v1' THEN
        RAISE EXCEPTION 'select v1 must show answer-v1, got %', v_content;
    END IF;

    -- Idempotent regenerate: same key does not create a third generation.
    PERFORM vc.receive_generation(
        1, 100, 'ver-2', 'user', 'hello', 'AUTO',
        (SELECT source_user_message_id FROM vc.generation WHERE id = v_gen2 AND owner_user_id = 1));
    SELECT count(*) INTO n FROM vc.generation WHERE owner_user_id = 1;
    IF n <> 2 THEN
        RAISE EXCEPTION 'duplicate regenerate key must not create a third generation, got %', n;
    END IF;

    BEGIN
        PERFORM vc.receive_generation(1, 100, 'ver-x', 'user', 'hello', 'AUTO', 999999);
        RAISE EXCEPTION 'foreign source unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%foreign source unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM vc.list_generation_versions(1, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed list_generation_versions';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
