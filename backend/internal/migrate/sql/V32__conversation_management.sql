-- TASK-CONV-MGMT V32: conversation management (delete + rename).
--
-- Adds two owner-scoped SECURITY DEFINER functions in the V17 trusted-owner
-- pattern (p_owner_user_id must match vc.current_owner_id()):
--   * delete_conversation — cancels the conversation's in-flight work items
--     (GENERATION / MEMORY_EXTRACT both reference the generation id) so no
--     worker ever processes a dangling ref, then deletes the conversation;
--     dependent rows (message, generation, realtime_event, usage, quota,
--     outbox) cascade via the existing ON DELETE CASCADE foreign keys.
--   * rename_conversation — writes the V2 conversation.title column (hitherto
--     unused) with a trimmed title; a blank title clears the rename (NULL).
-- Both return TRUE only when an owned row changed; a foreign or absent id
-- returns FALSE so existence is never disclosed at the API layer.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- delete_conversation: cancel in-flight work items, then delete (cascade).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.delete_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'delete_conversation: conversation id is required';
    END IF;
    -- V17 trusted-owner assertion: caller identity is server-trusted only.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_conversation: owner_user_id must match server-trusted context';
    END IF;
    -- Both work item kinds reference the generation id; a deleted conversation
    -- must never leave a worker processing a dangling ref (it would retry into
    -- dead-letter). In-flight items are cancelled before the rows cascade.
    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.ref_id IN (SELECT g.id
                          FROM vc.generation g
                         WHERE g.owner_user_id = p_owner_user_id
                           AND g.conversation_id = p_conversation_id);
    DELETE FROM vc.conversation
     WHERE owner_user_id = p_owner_user_id
       AND id = p_conversation_id;
    RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- rename_conversation: write the (hitherto unused) title column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.rename_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_title           text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_title text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'rename_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'rename_conversation: conversation id is required';
    END IF;
    -- V17 trusted-owner assertion: caller identity is server-trusted only.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'rename_conversation: owner_user_id must match server-trusted context';
    END IF;
    IF p_title IS NOT NULL AND length(p_title) > 200 THEN
        RAISE EXCEPTION 'rename_conversation: title exceeds 200 characters';
    END IF;
    -- A blank title clears the rename (NULL), keeping the list preview path.
    v_title := btrim(p_title);
    IF v_title = '' THEN
        v_title := NULL;
    END IF;
    UPDATE vc.conversation
       SET title = v_title
     WHERE owner_user_id = p_owner_user_id
       AND id = p_conversation_id;
    RETURN FOUND;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_conversations redefined with out_title: the rename path needs the title
-- in the list so the UI can show it (DROP required — CREATE OR REPLACE cannot
-- change the RETURNS column set). Body is identical to V30 plus the title.
-- ---------------------------------------------------------------------------
DROP FUNCTION vc.list_conversations(bigint, bigint, bigint, integer);

CREATE OR REPLACE FUNCTION vc.list_conversations(
    p_owner_user_id   bigint,
    p_relationship_id bigint DEFAULT NULL,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_created_at timestamptz,
                  out_last_message_role text, out_last_message_preview text,
                  out_title text)
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
               c.title
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

-- Re-apply the V30 privileges after the DROP.
REVOKE EXECUTE ON FUNCTION
    vc.list_conversations(bigint, bigint, bigint, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.list_conversations(bigint, bigint, bigint, integer)
    TO vc_api;

-- ---------------------------------------------------------------------------
-- Privileges: EXECUTE granted to vc_api alone, mirroring the V25/V30 pattern.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION vc.delete_conversation(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.rename_conversation(bigint, bigint, text) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.delete_conversation(bigint, bigint),
                vc.rename_conversation(bigint, bigint, text)
    TO vc_api;
