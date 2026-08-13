-- 31_message_history_pagination: list_messages returns deterministic keyset pages
-- over a conversation's messages ordered by (owner_user_id, id). The after-id
-- cursor advances the page; the limit is clamped to a safe band. The composite
-- ownership FK guarantees a cross-owner or cross-conversation lookup resolves to
-- no row (existence never disclosed).

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (2, 200, 20, 'bob-conv');

-- Owner 1 conversation 100 has 5 ordered messages; owner 2 conversation 200 has 3.
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content) VALUES
    (1, 1, 100, 'user', 'm1'), (1, 2, 100, 'assistant', 'm2'),
    (1, 3, 100, 'user', 'm3'), (1, 4, 100, 'assistant', 'm4'),
    (1, 5, 100, 'user', 'm5');
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content) VALUES
    (2, 1, 200, 'user', 'bob-m1'), (2, 2, 200, 'assistant', 'bob-m2'),
    (2, 3, 200, 'user', 'bob-m3');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    first_id bigint;
    last_id bigint;
BEGIN
    -- First page (limit 2): ids 1,2 in order.
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 0, 2);
    IF n <> 2 THEN RAISE EXCEPTION 'first page must have 2 rows, got %', n; END IF;
    SELECT out_id INTO first_id FROM vc.list_messages(1, 100, 0, 2) ORDER BY out_id LIMIT 1;
    IF first_id <> 1 THEN RAISE EXCEPTION 'first page must start at id 1, got %', first_id; END IF;

    -- Next page (after the last id of page 1 = 2): ids 3,4.
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 2, 2);
    IF n <> 2 THEN RAISE EXCEPTION 'second page must have 2 rows, got %', n; END IF;
    SELECT out_id INTO first_id FROM vc.list_messages(1, 100, 2, 2) ORDER BY out_id LIMIT 1;
    IF first_id <> 3 THEN RAISE EXCEPTION 'second page must start at id 3, got %', first_id; END IF;

    -- Final page (after 4): only id 5 remains.
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 4, 2);
    IF n <> 1 THEN RAISE EXCEPTION 'final page must have 1 row, got %', n; END IF;

    -- Past the end: empty.
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 5, 2);
    IF n <> 0 THEN RAISE EXCEPTION 'page past the end must be empty, got %', n; END IF;

    -- Limit clamped to the max: a huge limit still returns at most the page cap
    -- (100), and here only 5 rows exist.
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 0, 10000);
    IF n <> 5 THEN RAISE EXCEPTION 'clamped huge limit must return all 5 rows, got %', n; END IF;

    -- A non-positive limit falls back to the default page size (returns all 5).
    SELECT count(*) INTO n FROM vc.list_messages(1, 100, 0, 0);
    IF n <> 5 THEN RAISE EXCEPTION 'non-positive limit must use default, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Cross-conversation and cross-owner isolation: a conversation owned by another
-- user yields no rows, regardless of the requested cursor/limit (existence hidden).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    -- Conversation 200 belongs to owner 2; owner 1 sees nothing.
    SELECT count(*) INTO n FROM vc.list_messages(1, 200, 0, 50);
    IF n <> 0 THEN RAISE EXCEPTION 'owner 1 must see no messages in owner 2 conversation, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(2, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n int;
BEGIN
    -- Owner 2 cannot read owner 1's conversation 100.
    SELECT count(*) INTO n FROM vc.list_messages(2, 100, 0, 50);
    IF n <> 0 THEN RAISE EXCEPTION 'owner 2 must see no messages in owner 1 conversation, got %', n; END IF;

    -- Owner 2 reads its own conversation 200 with all 3 messages.
    SELECT count(*) INTO n FROM vc.list_messages(2, 200, 0, 50);
    IF n <> 3 THEN RAISE EXCEPTION 'owner 2 must see 3 own messages, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;
