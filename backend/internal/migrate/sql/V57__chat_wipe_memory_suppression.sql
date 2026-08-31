-- CHAT-WIPE / MEM-SUPPRESS V57: account-wide chat deletion + delete-time
-- extraction suppression.
--
-- CHAT-WIPE completes the FR-DATA-003 deletion granularities (单条消息/单次
-- 会话/单条记忆/角色全部关系数据/账号注销 already shipped): the user can
-- wipe ALL conversations across relationships while keeping the account, the
-- relationships and the confirmed long-term memories. In-flight GENERATION /
-- MEMORY_EXTRACT work items under those conversations are cancelled first
-- (the V49/V50 pattern); DATA_EXPORT items are account-level and untouched.
--
-- MEM-SUPPRESS is the minimal §11.16 rule: deleting a memory flips the V44
-- no_memory marker on the exact source messages of that memory's evidence
-- (refs of the form 'message:<id>'), so the extractor can never re-learn the
-- deleted memory from the same source. Only the boolean marker is stored —
-- never the deleted content; the marker stays user-reversible via
-- PATCH /messages/{id} {noMemory:false}.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- preview_chat_wipe: counts of what a wipe would clear right now.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.preview_chat_wipe(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_conversation_count bigint, out_message_count bigint,
                  out_in_flight_count bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'preview_chat_wipe: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'preview_chat_wipe: owner_user_id must match server-trusted context';
    END IF;

    SELECT count(*)::bigint INTO out_conversation_count
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id;

    SELECT count(*)::bigint INTO out_message_count
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id;

    SELECT count(*)::bigint INTO out_in_flight_count
      FROM vc.work_item w
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
       );
END;
$$;

-- ---------------------------------------------------------------------------
-- wipe_all_chats: cancel in-flight chat work items, then delete every
-- conversation of the owner (FK cascade removes messages, generations,
-- realtime rows). Relationships, memories, reminders and account-level rows
-- survive. Returns what was cleared.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.wipe_all_chats(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_conversations_deleted bigint, out_messages_deleted bigint,
                  out_work_items_cancelled bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'wipe_all_chats: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'wipe_all_chats: owner_user_id must match server-trusted context';
    END IF;

    SELECT count(*)::bigint INTO out_messages_deleted
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
       );
    GET DIAGNOSTICS out_work_items_cancelled = ROW_COUNT;

    DELETE FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id;
    GET DIAGNOSTICS out_conversations_deleted = ROW_COUNT;

    RETURN;
END;
$$;

-- ---------------------------------------------------------------------------
-- MEM-SUPPRESS: delete_memory additionally marks the exact source messages
-- of the deleted memory's evidence as no_memory (idempotent; refs not of the
-- 'message:<id>' shape — e.g. 'import:archive' — are ignored). Same
-- signature and grants as the V17 redefinition.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.delete_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'delete_memory: owner_user_id and memory_id are required';
    END IF;

    -- Lock the owned row if it exists. A foreign or absent id resolves to no
    -- row; existence is not disclosed.
    PERFORM 1
      FROM vc.memory_item
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'delete_memory: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;

    -- Idempotent: if already soft-deleted this affects 0 rows and we still
    -- return TRUE (matching the V11 documented intent).
    UPDATE vc.memory_item
       SET deleted_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
       AND deleted_at IS NULL;

    -- MEM-SUPPRESS (§11.16 minimal): the same sources must not re-extract
    -- the deleted memory. Only the reversible boolean marker is stored.
    UPDATE vc.message m
       SET no_memory = true
      FROM vc.memory_evidence e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.memory_item_id = p_memory_id
       AND e.source_ref ~ '^message:[0-9]+$'
       AND m.owner_user_id = e.owner_user_id
       AND m.id = (regexp_match(e.source_ref, '^message:([0-9]+)$'))[1]::bigint;
    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.preview_chat_wipe(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.wipe_all_chats(bigint) FROM PUBLIC;
GRANT EXECUTE
    ON FUNCTION vc.preview_chat_wipe(bigint),
                vc.wipe_all_chats(bigint)
    TO vc_api;
