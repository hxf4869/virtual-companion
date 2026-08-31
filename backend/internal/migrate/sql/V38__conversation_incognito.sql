-- INC-MODE V38: incognito conversations (FR-CHAT-005).
--
-- vc.conversation gains an incognito flag chosen at creation time (the
-- product rule is "enter knowingly": incognito is a creation-time decision,
-- never silently flipped later). create_conversation gains p_incognito
-- (default false) and freezes the flag on the row; list_conversations returns
-- out_incognito so the UI can badge the list and the open conversation.
--
-- Effects enforced in the runtime (not here): the generation handler skips
-- the MEMORY_EXTRACT work-item enqueue for incognito conversations, so no
-- long-term memory candidates are produced (FR-CHAT-005); recall of existing
-- RELATIONSHIP memory, safety checks and statutory logs are unaffected —
-- incognito is not "no records at all" and the UI says so.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.conversation
    ADD COLUMN IF NOT EXISTS incognito boolean NOT NULL DEFAULT false;

-- Replace the 2-arg create_conversation with the 3-arg form; the DEFAULT keeps
-- legacy positional callers (SQL tests with two args) working unchanged.
DROP FUNCTION IF EXISTS vc.create_conversation(bigint, bigint);

CREATE OR REPLACE FUNCTION vc.create_conversation(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_incognito       boolean DEFAULT false
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'create_conversation: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'create_conversation: relationship_id is required';
    END IF;
    -- V17 trusted-owner 断言：调用参数必须与 server-trusted GUC 一致。
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_conversation: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.conversation_id_seq');
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, incognito)
    VALUES (p_owner_user_id, v_id, p_relationship_id, COALESCE(p_incognito, false));
    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.create_conversation(bigint, bigint, boolean)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.create_conversation(bigint, bigint, boolean)
    TO vc_api;

-- list_conversations: add out_incognito to the row shape (additive column;
-- named-column callers are unaffected, `SELECT *` callers gain one column).
-- The return row type changes, so the function must be dropped first
-- (CREATE OR REPLACE cannot change OUT parameter types).
DROP FUNCTION IF EXISTS vc.list_conversations(bigint, bigint, bigint, integer);

CREATE OR REPLACE FUNCTION vc.list_conversations(
    p_owner_user_id   bigint,
    p_relationship_id bigint DEFAULT NULL,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_created_at timestamptz,
                  out_last_message_role text, out_last_message_preview text,
                  out_title text, out_incognito boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    -- V17 trusted-owner 断言：调用参数必须与 server-trusted GUC 一致。
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 THEN
        p_limit := 50;
    END IF;
    IF p_limit > 100 THEN
        p_limit := 100;
    END IF;
    IF p_after_id IS NULL THEN
        p_after_id := 0;
    END IF;

    RETURN QUERY
        SELECT c.id, c.relationship_id, c.created_at, lm.role, left(lm.content, 200),
               c.title, c.incognito
          FROM vc.conversation c
          LEFT JOIN LATERAL (
              SELECT m.role, m.content
                FROM vc.message m
               WHERE m.owner_user_id = c.owner_user_id
                 AND m.conversation_id = c.id
               ORDER BY m.id DESC
               LIMIT 1
          ) lm ON true
         WHERE c.owner_user_id = p_owner_user_id
           AND (p_relationship_id IS NULL OR c.relationship_id = p_relationship_id)
           AND c.id > p_after_id
         ORDER BY c.id
         LIMIT p_limit;
END;
$$;

-- The drop removed the V30 grants; re-apply the closed-by-default posture.
REVOKE EXECUTE ON FUNCTION
    vc.list_conversations(bigint, bigint, bigint, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.list_conversations(bigint, bigint, bigint, integer)
    TO vc_api;
