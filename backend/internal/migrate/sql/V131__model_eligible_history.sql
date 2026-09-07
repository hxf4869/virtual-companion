-- 2026-09-06 remediation round, N-01 (F-01): model-facing history reads gain
-- the persisted egress fact vc.message.model_eligible (V112).
--
-- The turn context seed (LoadSeed) reused the user-facing reads
-- vc.list_messages / vc.go_list_recent_messages, so a blocked or cancelled
-- turn's messages — persisted for data rights, but marked model_eligible=false
-- by V112 — rode along in every later provider request as "history". The
-- user-facing reads must keep seeing every row (history and export visibility
-- are unchanged); the model context needs its own narrow reads that filter on
-- the eligibility fact BEFORE the LIMIT, so an ineligible recent page cannot
-- silently shorten the eligible window.
--
-- Contract (V124/V53 shapes + the eligibility predicate):
--   go_list_model_recent_messages — newest p_limit eligible messages with
--     id < p_before_id (exclusive), rows always emitted ascending;
--   go_list_model_history_messages — earliest p_limit eligible messages with
--     id > p_after_id, ascending (the legacy seed branch without a source
--     message keeps its forward-from-start shape);
--   assistant messages only expose the selected generation (unchanged);
--   limit defaults to 50 and is capped at 100;
--   owner-bound via vc.current_owner_id(), least-privilege execute.
--   go_message_model_eligible — the persisted egress fact for one message,
--     so a retried turn re-checks its own source message before re-sending
--     it as current input; a missing row fails closed.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.go_list_model_recent_messages(
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
        RAISE EXCEPTION 'go_list_model_recent_messages: owner_user_id and conversation_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_list_model_recent_messages: owner_user_id must match server-trusted context';
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
               AND m.model_eligible
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

CREATE FUNCTION vc.go_list_model_history_messages(
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
        RAISE EXCEPTION 'go_list_model_history_messages: owner_user_id and conversation_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_list_model_history_messages: owner_user_id must match server-trusted context';
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
        SELECT m.id, m.role, m.content, m.created_at, m.no_memory
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.conversation_id = p_conversation_id
           AND m.id > p_after_id
           AND m.model_eligible
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
         ORDER BY m.id
         LIMIT p_limit;
END;
$$;

CREATE FUNCTION vc.go_message_model_eligible(
    p_owner_user_id bigint,
    p_message_id    bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_eligible boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_message_id IS NULL THEN
        RAISE EXCEPTION 'go_message_model_eligible: owner_user_id and message_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_message_model_eligible: owner_user_id must match server-trusted context';
    END IF;

    -- Fail closed: a missing row is an integrity anomaly, and the caller must
    -- not treat an unknown row as re-sendable.
    SELECT m.model_eligible INTO v_eligible
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.id = p_message_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    RETURN v_eligible;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_list_model_recent_messages(bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_model_recent_messages(bigint, bigint, bigint, integer) TO vc_api;

REVOKE ALL ON FUNCTION vc.go_list_model_history_messages(bigint, bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_list_model_history_messages(bigint, bigint, bigint, integer) TO vc_api;

REVOKE ALL ON FUNCTION vc.go_message_model_eligible(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_message_model_eligible(bigint, bigint) TO vc_api;
