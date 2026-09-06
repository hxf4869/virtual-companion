-- V130: stable id-keyset listing for the data export worker (audit L1).
--
-- The export loop paged through vc.list_conversations, whose keyset cursor is
-- (last_activity_at, id). last_activity_at is derived from the newest message
-- and therefore mutable: a conversation that receives a message while a large
-- export is running can jump across the cursor, so whole pages are skipped or
-- repeated. Export integrity needs a cursor on an immutable key.
--
-- Contract (export worker only; the frontend keeps vc.list_conversations):
--   p_after_id NULL -> newest p_limit conversations by id DESC;
--   p_after_id set  -> next p_limit conversations with id < p_after_id
--                      (exclusive, so a caller passes its smallest loaded id);
--   column shape matches vc.list_conversations so the Go scan is uniform
--   (export itself only consumes id/relationship/incognito);
--   limit defaults to 50 and is capped at 100;
--   owner-bound via vc.current_owner_id(), least-privilege execute.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.go_list_export_conversations(
    p_owner_user_id bigint,
    p_after_id      bigint DEFAULT NULL,
    p_limit         integer DEFAULT 50
)
    RETURNS TABLE(
        out_id bigint,
        out_relationship_id bigint,
        out_created_at timestamptz,
        out_last_message_role text,
        out_last_message_preview text,
        out_title text,
        out_incognito boolean,
        out_last_activity_at timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'go_list_export_conversations: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_list_export_conversations: owner_user_id must match server-trusted context';
    END IF;

    IF p_limit IS NULL OR p_limit < 1 THEN
        p_limit := 50;
    END IF;
    IF p_limit > 100 THEN
        p_limit := 100;
    END IF;

    RETURN QUERY
        SELECT c.id,
               c.relationship_id,
               c.created_at,
               lm.role,
               left(lm.content, 200),
               c.title,
               c.incognito,
               COALESCE(lm.created_at, c.created_at)
          FROM vc.conversation c
          LEFT JOIN LATERAL (
              SELECT m.role, m.content, m.created_at
                FROM vc.message m
               WHERE m.owner_user_id = c.owner_user_id
                 AND m.conversation_id = c.id
               ORDER BY m.id DESC
               LIMIT 1
          ) lm ON true
         WHERE c.owner_user_id = p_owner_user_id
           AND (p_after_id IS NULL OR c.id < p_after_id)
         ORDER BY c.id DESC
         LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_list_export_conversations(bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_export_conversations(bigint, bigint, integer) TO vc_api;

DO $$
BEGIN
    IF to_regprocedure('vc.go_list_export_conversations(bigint,bigint,integer)') IS NULL THEN
        RAISE EXCEPTION 'V130: required function is missing';
    END IF;
    IF has_function_privilege('public',
            'vc.go_list_export_conversations(bigint,bigint,integer)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V130: public execute must stay revoked';
    END IF;
END;
$$;
