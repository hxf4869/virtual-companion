-- MSG-DELETE V37: single-message deletion (FR-CHAT-004 / FR-DATA-003).
--
-- vc.delete_message deletes one message of the caller's conversation in the
-- V17 trusted-owner pattern (p_owner_user_id must match vc.current_owner_id()).
-- In the same transaction it removes the memory_evidence rows whose
-- source_ref points at the message ('message:<id>'), so no dangling evidence
-- survives a deletion; the confirmed memory items themselves keep their
-- content and stay manageable in the memory center (they are independent
-- canonical data with their own edit/delete lifecycle). The
-- generation.assistant_message_id link is cleared by the existing V7
-- ON DELETE SET NULL foreign key when a final assistant message is deleted.
--
-- Returns TRUE only when an owned message in the given conversation changed;
-- a foreign or absent message returns FALSE so existence is never disclosed
-- at the API layer.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.delete_message(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_message_id      bigint
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
        RAISE EXCEPTION 'delete_message: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'delete_message: conversation id is required';
    END IF;
    IF p_message_id IS NULL OR p_message_id <= 0 THEN
        RAISE EXCEPTION 'delete_message: message id is required';
    END IF;
    -- V17 trusted-owner assertion: caller identity is server-trusted only.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_message: owner_user_id must match server-trusted context';
    END IF;

    -- Evidence cleanup first (same transaction): the textual source_ref
    -- 'message:<id>' is the only reference memory keeps to the message.
    DELETE FROM vc.memory_evidence
     WHERE owner_user_id = p_owner_user_id
       AND source_ref = 'message:' || p_message_id;

    DELETE FROM vc.message
     WHERE owner_user_id = p_owner_user_id
       AND id = p_message_id
       AND conversation_id = p_conversation_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Closed by default: only the API ingestion role may delete messages.
REVOKE EXECUTE ON FUNCTION
    vc.delete_message(bigint, bigint, bigint)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.delete_message(bigint, bigint, bigint)
    TO vc_api;
