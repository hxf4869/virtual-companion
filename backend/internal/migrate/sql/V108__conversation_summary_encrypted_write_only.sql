-- S0-32 completion: runtime roles can append conversation summaries only through
-- an enc2-only wrapper. The old SQL turn writer is removed because it briefly
-- inserted plaintext; legacy runtime now reads metadata, encrypts, then appends atomically
-- inside the existing owner-bound finalize transaction.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.record_encrypted_conversation_summary(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_from_message_id bigint,
    p_to_message_id   bigint,
    p_summary         text,
    p_model_id        text,
    p_model_version   text,
    p_prompt_version  text,
    p_confidence      real,
    p_validated       boolean,
    p_service_class   text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_summary IS NULL OR p_summary !~
            '^enc2:[a-z][a-z0-9-]{0,31}:[1-9][0-9]*:[A-Za-z0-9+/]+={0,2}$' THEN
        RAISE EXCEPTION 'record_encrypted_conversation_summary: enc2 ciphertext is required';
    END IF;
    RETURN vc.record_conversation_summary(
        p_owner_user_id, p_conversation_id, p_from_message_id, p_to_message_id,
        p_summary, p_model_id, p_model_version, p_prompt_version,
        p_confidence, p_validated, p_service_class);
END;
$$;

CREATE FUNCTION vc.conversation_summary_turn_metadata(
    p_owner_user_id bigint,
    p_generation_id bigint
)
    RETURNS TABLE(
        out_conversation_id bigint,
        out_from_message_id bigint,
        out_to_message_id bigint,
        out_message_count bigint,
        out_service_class text)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_conversation_id bigint;
    v_incognito boolean;
    v_from_message_id bigint;
    v_to_message_id bigint;
    v_message_count bigint;
    v_service_class text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'conversation_summary_turn_metadata: positive ids are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'conversation_summary_turn_metadata: owner_user_id must match server-trusted context';
    END IF;

    SELECT g.conversation_id, c.incognito,
           COALESCE(e.actual_service_class, e.service_class, 'ECONOMY')
      INTO v_conversation_id, v_incognito, v_service_class
      FROM vc.generation g
      JOIN vc.conversation c
        ON c.owner_user_id = g.owner_user_id AND c.id = g.conversation_id
      LEFT JOIN vc.entitlement_snapshot e
        ON e.owner_user_id = g.owner_user_id AND e.generation_id = g.id
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id;
    IF v_conversation_id IS NULL THEN
        RAISE EXCEPTION 'conversation_summary_turn_metadata: generation not found for owner';
    END IF;
    IF v_incognito THEN
        RETURN;
    END IF;

    SELECT m.id INTO v_to_message_id
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.generation_id = p_generation_id
       AND m.role = 'assistant'
     ORDER BY m.id DESC
     LIMIT 1;
    IF v_to_message_id IS NULL THEN
        RETURN;
    END IF;

    SELECT min(m.id), count(*)
      INTO v_from_message_id, v_message_count
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.conversation_id = v_conversation_id;
    IF v_from_message_id IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT
        v_conversation_id, v_from_message_id, v_to_message_id,
        v_message_count, v_service_class;
END;
$$;

CREATE FUNCTION vc.conversation_summary_cipher_ready(p_current_prefix text)
    RETURNS boolean
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_current_prefix IS NULL
       OR left(p_current_prefix, 5) <> 'enc2:'
       OR right(p_current_prefix, 1) <> ':' THEN
        RAISE EXCEPTION 'conversation_summary_cipher_ready: current prefix must be enc2:<keyId>:<version>:';
    END IF;
    RETURN NOT EXISTS (
        SELECT 1 FROM vc.conversation_summary s
         WHERE s.valid AND s.summary NOT LIKE p_current_prefix || '%');
END;
$$;

REVOKE ALL ON FUNCTION vc.record_encrypted_conversation_summary(
    bigint, bigint, bigint, bigint, text, text, text, text, real, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.conversation_summary_turn_metadata(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.conversation_summary_cipher_ready(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_encrypted_conversation_summary(
    bigint, bigint, bigint, bigint, text, text, text, text, real, boolean, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.conversation_summary_turn_metadata(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.conversation_summary_cipher_ready(text) TO vc_api;

-- Runtime code must not retain either plaintext-capable write surface.
REVOKE EXECUTE ON FUNCTION vc.record_conversation_summary(
    bigint, bigint, bigint, bigint, text, text, text, text, real, boolean, text) FROM vc_api;
DROP FUNCTION vc.record_turn_summary(bigint, bigint);
DROP FUNCTION vc.conversation_summary_stored_text(bigint, bigint);

-- User message deletion removes every derived summary that covered that message.
-- Break any surviving chain pointer first; user deletion takes precedence over the
-- former append-only summary audit. Also remove already-invalid legacy rows once.
UPDATE vc.conversation_summary surviving
   SET prev_id = NULL
 WHERE surviving.prev_id IN (
       SELECT doomed.id FROM vc.conversation_summary doomed WHERE NOT doomed.valid);
DELETE FROM vc.conversation_summary WHERE NOT valid;

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
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_message: owner_user_id must match server-trusted context';
    END IF;

    DELETE FROM vc.memory_evidence
     WHERE owner_user_id = p_owner_user_id
       AND source_ref = 'message:' || p_message_id;

    DELETE FROM vc.message
     WHERE owner_user_id = p_owner_user_id
       AND id = p_message_id
       AND conversation_id = p_conversation_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN false;
    END IF;

    UPDATE vc.conversation_summary surviving
       SET prev_id = NULL
     WHERE surviving.owner_user_id = p_owner_user_id
       AND surviving.conversation_id = p_conversation_id
       AND surviving.prev_id IN (
           SELECT doomed.id
             FROM vc.conversation_summary doomed
            WHERE doomed.owner_user_id = p_owner_user_id
              AND doomed.conversation_id = p_conversation_id
              AND doomed.from_message_id <= p_message_id
              AND doomed.to_message_id >= p_message_id);

    DELETE FROM vc.conversation_summary doomed
     WHERE doomed.owner_user_id = p_owner_user_id
       AND doomed.conversation_id = p_conversation_id
       AND doomed.from_message_id <= p_message_id
       AND doomed.to_message_id >= p_message_id;
    RETURN true;
END;
$$;
