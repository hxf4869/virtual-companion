-- 85_conversation_list_scope: list_conversations returns the caller's
-- conversations keyset-paginated by (owner_user_id, id) with a clamped
-- last-message preview. The optional relationship filter never discloses a
-- foreign relationship's existence (no rows, indistinguishable from empty);
-- an empty conversation carries NULL role and NULL preview; the preview is the
-- LAST message, not the first.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 11, 'persona-a2', false);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (2, 20, 'persona-bob', true);
-- Owner 1: 100 (rel 10, messages), 101 (rel 11, EMPTY), 102 (rel 10, messages).
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES
    (1, 100, 10, 'a1'), (1, 101, 11, 'a2'), (1, 102, 10, 'a3');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES (2, 200, 20, 'b1');
-- Conversation 100: first message short, LAST message is the long assistant one.
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content) VALUES
    (1, 1, 100, 'user', 'first'),
    (1, 2, 100, 'assistant', repeat('x', 300));
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content) VALUES
    (1, 3, 102, 'user', 'u1'), (1, 4, 102, 'assistant', 'a1');
INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content) VALUES
    (2, 1, 200, 'user', 'bob-m1');

-- Owner 1: full list, relationship filter, keyset, clamps, empty preview.
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    first_id bigint;
    v_role text;
    v_preview text;
BEGIN
    -- Unfiltered list: 3 rows ascending by id.
    SELECT count(*) INTO n FROM vc.list_conversations(1, NULL, 0, 50);
    IF n <> 3 THEN RAISE EXCEPTION 'owner 1 must list 3 conversations, got %', n; END IF;
    SELECT out_id INTO first_id FROM vc.list_conversations(1, NULL, 0, 50) ORDER BY out_id LIMIT 1;
    IF first_id <> 100 THEN RAISE EXCEPTION 'list must start at 100, got %', first_id; END IF;

    -- Preview is the LAST message (assistant, clamped to 200 chars).
    SELECT out_last_message_role, out_last_message_preview
      INTO v_role, v_preview FROM vc.list_conversations(1, NULL, 0, 50)
     WHERE out_id = 100;
    IF v_role IS DISTINCT FROM 'assistant' THEN
        RAISE EXCEPTION 'conversation 100 preview role must be assistant, got %', v_role;
    END IF;
    IF v_preview IS NULL OR length(v_preview) <> 200
       OR v_preview <> left(repeat('x', 300), 200) THEN
        RAISE EXCEPTION 'conversation 100 preview must be the 200-char clamp of the last message';
    END IF;

    -- Empty conversation: NULL role and NULL preview.
    SELECT out_last_message_role, out_last_message_preview
      INTO v_role, v_preview FROM vc.list_conversations(1, NULL, 0, 50)
     WHERE out_id = 101;
    IF v_role IS NOT NULL OR v_preview IS NOT NULL THEN
        RAISE EXCEPTION 'empty conversation 101 must carry NULL preview (got role=%, preview=%)',
            v_role, v_preview;
    END IF;

    -- Relationship filter: rel 10 -> 100,102; rel 11 -> 101; foreign rel 20 -> none.
    SELECT count(*) INTO n FROM vc.list_conversations(1, 10, 0, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'rel 10 must list 2 conversations, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_conversations(1, 11, 0, 50);
    IF n <> 1 THEN RAISE EXCEPTION 'rel 11 must list 1 conversation, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_conversations(1, 20, 0, 50);
    IF n <> 0 THEN RAISE EXCEPTION 'foreign relationship filter must yield no rows, got %', n; END IF;

    -- Keyset: after 100 -> 101,102; after 102 -> empty.
    SELECT count(*) INTO n FROM vc.list_conversations(1, NULL, 100, 50);
    IF n <> 2 THEN RAISE EXCEPTION 'page after 100 must have 2 rows, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_conversations(1, NULL, 102, 50);
    IF n <> 0 THEN RAISE EXCEPTION 'page after 102 must be empty, got %', n; END IF;

    -- Limit band: limit 1 -> 1 row; huge limit -> clamped (all 3 rows).
    SELECT count(*) INTO n FROM vc.list_conversations(1, NULL, 0, 1);
    IF n <> 1 THEN RAISE EXCEPTION 'limit 1 must return 1 row, got %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_conversations(1, NULL, 0, 10000);
    IF n <> 3 THEN RAISE EXCEPTION 'huge limit must be clamped and return 3 rows, got %', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 sees only its own conversation; owner 1's ids resolve to no rows.
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    v_role text;
    v_preview text;
BEGIN
    SELECT count(*) INTO n FROM vc.list_conversations(2, NULL, 0, 50);
    IF n <> 1 THEN RAISE EXCEPTION 'owner 2 must list exactly 1 conversation, got %', n; END IF;
    SELECT out_last_message_role, out_last_message_preview
      INTO v_role, v_preview FROM vc.list_conversations(2, NULL, 0, 50)
     WHERE out_id = 200;
    IF v_role IS DISTINCT FROM 'user' OR v_preview IS DISTINCT FROM 'bob-m1' THEN
        RAISE EXCEPTION 'owner 2 preview must be (user, bob-m1), got (%, %)', v_role, v_preview;
    END IF;
END $$;
COMMIT;
RESET ROLE;
