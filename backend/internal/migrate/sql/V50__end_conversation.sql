-- END-TODAY V50: end today's conversation (session close + incognito body clear).
--
-- vc.end_conversation is a V17 trusted-owner SECURITY DEFINER function:
--   * cancels in-flight GENERATION / MEMORY_EXTRACT work items that reference
--     generations of this conversation (same dangling-ref rule as V32);
--   * if the conversation is incognito, clears vc.message.content so list
--     previews and history no longer expose the original text;
--   * never deletes the conversation row, Companion, relationship, generation,
--     safety or statutory/audit rows.
-- Returns no row for a foreign or absent id (existence hidden). One row with
-- out_ok=true and out_incognito_cleared reflecting whether bodies were wiped.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.end_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS TABLE(out_ok boolean, out_incognito_cleared boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_incognito boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: conversation id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id must match server-trusted context';
    END IF;

    SELECT c.incognito INTO v_incognito
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id
       AND c.id = p_conversation_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
             WHERE g.owner_user_id = p_owner_user_id
               AND g.conversation_id = p_conversation_id
       );

    IF v_incognito THEN
        UPDATE vc.message
           SET content = ''
         WHERE owner_user_id = p_owner_user_id
           AND conversation_id = p_conversation_id;
    END IF;

    out_ok := true;
    out_incognito_cleared := COALESCE(v_incognito, false);
    RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.end_conversation(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.end_conversation(bigint, bigint) TO vc_api;
