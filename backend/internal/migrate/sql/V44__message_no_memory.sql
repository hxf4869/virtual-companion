-- MEM-NEG V44: per-message "don't remember" negative marker (FR-CHAT-001
-- 消息操作：不记住; message.no_memory per the V0.3 spec §16.2.5).
--
-- A user can mark a message as no_memory=true; the memory-extraction worker
-- then skips that message when proposing candidates, so the negative intent
-- survives at the source instead of being re-extracted from history. The flag
-- is message-level, reversible (false restores extraction), and applies to
-- any role (only user messages are extraction sources today). All access
-- flows through the V17 trusted-owner SD function; the runtime role has no
-- direct DML on the business table.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.message
    ADD COLUMN IF NOT EXISTS no_memory boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- set_message_no_memory: flip the negative-memory marker of one owned
-- message. Returns TRUE only when an owned row changed; a foreign or absent
-- id returns FALSE (existence is never disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.set_message_no_memory(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_message_id      bigint,
    p_no_memory       boolean
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'set_message_no_memory: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'set_message_no_memory: conversation_id is required';
    END IF;
    IF p_message_id IS NULL OR p_message_id <= 0 THEN
        RAISE EXCEPTION 'set_message_no_memory: message_id is required';
    END IF;
    IF p_no_memory IS NULL THEN
        RAISE EXCEPTION 'set_message_no_memory: no_memory is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'set_message_no_memory: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.message
       SET no_memory = p_no_memory
     WHERE owner_user_id = p_owner_user_id
       AND conversation_id = p_conversation_id
       AND id = p_message_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Closed by default: only the API ingestion role may flip the marker.
REVOKE EXECUTE ON FUNCTION vc.set_message_no_memory(bigint, bigint, bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.set_message_no_memory(bigint, bigint, bigint, boolean) TO vc_api;

-- ---------------------------------------------------------------------------
-- Append-only redefinition of list_messages (V10) to surface the no_memory
-- marker so the history UI can show the negative-memory state and offer
-- "恢复记忆". PostgreSQL forbids CREATE OR REPLACE across a changed OUT row
-- type, so the function is dropped and recreated; the EXECUTE grants are
-- re-applied below (REVOKE PUBLIC / GRANT vc_api, same as V10).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.list_messages(bigint, bigint, bigint, integer);

CREATE OR REPLACE FUNCTION vc.list_messages(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_role text,
                  out_content text, out_created_at timestamptz,
                  out_no_memory boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'list_messages: owner_user_id and conversation_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Clamp the page size into a safe band; defaults are applied for NULL/empty.
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
        SELECT m.id, m.role, m.content, m.created_at, m.no_memory
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.conversation_id = p_conversation_id
           AND m.id > p_after_id
         ORDER BY m.id
         LIMIT p_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.list_messages(bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_messages(bigint, bigint, bigint, integer) TO vc_api;
