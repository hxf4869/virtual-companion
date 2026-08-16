-- CONV-HIST V30: conversation listing with last-message preview.
--
-- Gap: the runtime can create a conversation (V25 create_conversation) and read
-- one conversation's messages (V10 list_messages), but there is no way to
-- enumerate the caller's conversations. The H5 chat page therefore opens a
-- fresh conversation on every visit and history navigation is impossible.
--
-- This migration adds ONE SECURITY DEFINER function:
--   vc.list_conversations(owner, relationship_id, after_id, limit)
--     -> (out_id, out_relationship_id, out_created_at,
--         out_last_message_role, out_last_message_preview)
--
-- Contract (specs/openapi listConversations):
--  - keyset pagination by the composite key (owner_user_id, id), ascending id;
--    the after cursor is the last conversation id seen;
--  - limit clamped to [1, 100], default 50 (same band as list_messages);
--  - optional relationship filter: a foreign or absent relationship resolves
--    to no rows, indistinguishable from an empty list, so existence is never
--    disclosed (same semantics as list_memory);
--  - last-message preview is (role, content clamped to 200 chars); an empty
--    conversation carries NULL role and NULL preview. The preview is a
--    display convenience, never a substitute for list_messages.
--
-- No table/constraint/privilege change to any existing object. V1-V29 frozen
-- (Flyway checksum safe).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- list_conversations: keyset-paginated conversation list for the caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_conversations(
    p_owner_user_id   bigint,
    p_relationship_id bigint DEFAULT NULL,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_created_at timestamptz,
                  out_last_message_role text, out_last_message_preview text)
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
        SELECT c.id, c.relationship_id, c.created_at, lm.role, left(lm.content, 200)
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

-- Every new SECURITY DEFINER function defaults to PUBLIC EXECUTE. Revoke it and
-- grant only vc_api (TASK-0016 P0 class), matching the V7-V29 baseline.
REVOKE EXECUTE ON FUNCTION
    vc.list_conversations(bigint, bigint, bigint, integer)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.list_conversations(bigint, bigint, bigint, integer)
    TO vc_api;

-- ---------------------------------------------------------------------------
-- Migration-end fail-closed DO block: assert the critical invariants.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_bad boolean := false;
BEGIN
    IF to_regprocedure('vc.list_conversations(bigint,bigint,bigint,integer)') IS NULL THEN
        RAISE EXCEPTION 'V30: list_conversations missing';
    END IF;
    IF NOT has_function_privilege('vc_api',
            'vc.list_conversations(bigint,bigint,bigint,integer)', 'EXECUTE') THEN
        v_bad := true;
    END IF;
    IF has_function_privilege('public',
            'vc.list_conversations(bigint,bigint,bigint,integer)', 'EXECUTE') THEN
        v_bad := true;
    END IF;
    IF v_bad THEN
        RAISE EXCEPTION 'V30: list_conversations privileges are not as expected';
    END IF;
END;
$$;
