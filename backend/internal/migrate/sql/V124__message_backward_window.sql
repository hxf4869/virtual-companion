-- WP-B audit remediation: backward (recent-window) message pagination.
--
-- vc.list_messages only pages forward (id > after). Long conversations had no
-- way to load the most recent history, and the turn context seed read the
-- EARLIEST window instead of the recent one. This adds the missing read shape
-- without touching the forward path: export and streaming resume keep their
-- existing semantics.
--
-- Contract (same visibility as vc.list_messages, FR-CHAT-003):
--   p_before_id NULL -> newest p_limit messages of the conversation;
--   p_before_id set  -> newest p_limit messages with id < p_before_id
--                       (exclusive, so a caller passes its oldest loaded id);
--   rows are ALWAYS emitted in ascending id order;
--   assistant messages only expose the selected generation;
--   limit defaults to 50 and is capped at 100;
--   owner-bound via vc.current_owner_id(), least-privilege execute.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.go_list_recent_messages(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_before_id       bigint DEFAULT NULL,
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
        RAISE EXCEPTION 'go_list_recent_messages: owner_user_id and conversation_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_list_recent_messages: owner_user_id must match server-trusted context';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 THEN
        p_limit := 50;
    END IF;
    IF p_limit > 100 THEN
        p_limit := 100;
    END IF;

    RETURN QUERY
        WITH window_rows AS (
            SELECT m.id, m.role, m.content, m.created_at, m.no_memory
              FROM vc.message m
             WHERE m.owner_user_id = p_owner_user_id
               AND m.conversation_id = p_conversation_id
               AND (p_before_id IS NULL OR m.id < p_before_id)
               AND (
                    m.role IS DISTINCT FROM 'assistant'
                    OR m.generation_id IS NULL
                    OR EXISTS (
                        SELECT 1
                          FROM vc.generation g
                         WHERE g.owner_user_id = m.owner_user_id
                           AND g.id = m.generation_id
                           AND g.selected
                    )
               )
             ORDER BY m.id DESC
             LIMIT p_limit
        )
        SELECT w.id, w.role, w.content, w.created_at, w.no_memory
          FROM window_rows w
         ORDER BY w.id;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_list_recent_messages(bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_recent_messages(bigint, bigint, bigint, integer) TO vc_api;
