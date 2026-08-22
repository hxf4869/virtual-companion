-- S0-32: conversation_summary at-rest encryption helpers.
--
-- RestFieldCipher (enc2:<keyId>:<version>:) is the application-layer write
-- form. SQL never holds the key. This migration:
--   1) widens record_conversation_summary stored-length so an enc2 blob of a
--      1..4000 plaintext fits (plaintext length stays a Java/API contract);
--   2) adds checkpoint scan/replace for stale summary rows (plaintext, enc1,
--      or previous enc2), matching V78's message helpers;
--   3) adds a single-row stored-text reader so record_turn_summary's SQL
--      plaintext can be sealed in the next statement.
-- Invalidated (deleted-coverage) rows keep ciphertext; backup/PITR restore
-- still yields enc2 which the app decrypts — no plaintext resurrection.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.record_conversation_summary(
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
DECLARE
    v_prev_id bigint;
    v_prev_class text;
    v_prev_valid boolean;
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_conversation_summary: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'record_conversation_summary: conversation_id is required';
    END IF;
    IF p_from_message_id IS NULL OR p_to_message_id IS NULL
       OR p_from_message_id <= 0 OR p_to_message_id <= 0
       OR p_from_message_id > p_to_message_id THEN
        RAISE EXCEPTION 'record_conversation_summary: message range is invalid';
    END IF;
    -- 24576 holds enc2 of a 4000-char CJK plaintext; API still validates 4000.
    IF p_summary IS NULL OR btrim(p_summary) = '' OR length(p_summary) > 24576 THEN
        RAISE EXCEPTION 'record_conversation_summary: summary must be 1..24576 characters';
    END IF;
    IF p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_version IS NULL OR btrim(p_model_version) = ''
       OR p_prompt_version IS NULL OR btrim(p_prompt_version) = '' THEN
        RAISE EXCEPTION 'record_conversation_summary: model/prompt versions are required';
    END IF;
    IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
        RAISE EXCEPTION 'record_conversation_summary: confidence must be within [0,1]';
    END IF;
    IF p_service_class NOT IN ('ECONOMY', 'PREMIUM') THEN
        RAISE EXCEPTION 'record_conversation_summary: unapproved service class';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_conversation_summary: owner_user_id must match server-trusted context';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.conversation c
                    WHERE c.owner_user_id = p_owner_user_id
                      AND c.id = p_conversation_id) THEN
        RAISE EXCEPTION 'record_conversation_summary: conversation not found for owner';
    END IF;

    SELECT s.id, s.service_class, s.valid INTO v_prev_id, v_prev_class, v_prev_valid
      FROM vc.conversation_summary s
     WHERE s.owner_user_id = p_owner_user_id
       AND s.conversation_id = p_conversation_id
     ORDER BY s.id DESC
     LIMIT 1;

    IF v_prev_id IS NOT NULL AND v_prev_class = 'PREMIUM'
       AND v_prev_valid
       AND p_service_class = 'ECONOMY' THEN
        RETURN 0;
    END IF;

    v_id := nextval('vc.conversation_summary_id_seq');
    INSERT INTO vc.conversation_summary(
        owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence,
        validated, service_class, prev_id)
    VALUES (
        p_owner_user_id, v_id, p_conversation_id, p_from_message_id,
        p_to_message_id, btrim(p_summary), btrim(p_model_id),
        btrim(p_model_version), btrim(p_prompt_version), p_confidence,
        COALESCE(p_validated, true), p_service_class, v_prev_id);
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.conversation_summary_stored_text(
    p_owner_user_id bigint,
    p_summary_id    bigint
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_text text;
BEGIN
    IF p_owner_user_id IS NULL OR p_summary_id IS NULL THEN
        RAISE EXCEPTION 'conversation_summary_stored_text: arguments are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'conversation_summary_stored_text: owner_user_id must match server-trusted context';
    END IF;
    SELECT s.summary INTO v_text
      FROM vc.conversation_summary s
     WHERE s.owner_user_id = p_owner_user_id AND s.id = p_summary_id;
    RETURN v_text;
END;
$$;

CREATE FUNCTION vc.backfill_stale_cipher_summary_batch(
    p_after_id        bigint,
    p_limit           int,
    p_current_prefix  text
)
    RETURNS TABLE(out_owner_user_id bigint, out_id bigint, out_content text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 2000);
BEGIN
    IF p_after_id IS NULL THEN
        RAISE EXCEPTION 'backfill_stale_cipher_summary_batch: after_id is required';
    END IF;
    IF p_current_prefix IS NULL
       OR left(p_current_prefix, 5) <> 'enc2:'
       OR right(p_current_prefix, 1) <> ':' THEN
        RAISE EXCEPTION 'backfill_stale_cipher_summary_batch: current prefix must be enc2:<keyId>:<version>:';
    END IF;
    RETURN QUERY
    SELECT s.owner_user_id, s.id, s.summary
      FROM vc.conversation_summary s
     WHERE s.id > p_after_id
       AND s.summary IS NOT NULL
       AND s.summary NOT LIKE p_current_prefix || '%'
     ORDER BY s.id
     LIMIT v_limit;
END;
$$;

CREATE FUNCTION vc.backfill_replace_summary_cipher(
    p_owner_user_id   bigint,
    p_summary_id      bigint,
    p_cipher          text,
    p_current_prefix  text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_updated int;
BEGIN
    IF p_owner_user_id IS NULL OR p_summary_id IS NULL
       OR p_cipher IS NULL OR p_current_prefix IS NULL THEN
        RAISE EXCEPTION 'backfill_replace_summary_cipher: all arguments are required';
    END IF;
    IF left(p_current_prefix, 5) <> 'enc2:'
       OR right(p_current_prefix, 1) <> ':' THEN
        RAISE EXCEPTION 'backfill_replace_summary_cipher: current prefix must be enc2:<keyId>:<version>:';
    END IF;
    IF left(p_cipher, length(p_current_prefix)) IS DISTINCT FROM p_current_prefix THEN
        RAISE EXCEPTION 'backfill_replace_summary_cipher: cipher must carry the current write prefix';
    END IF;
    UPDATE vc.conversation_summary
       SET summary = p_cipher
     WHERE owner_user_id = p_owner_user_id
       AND id = p_summary_id
       AND summary IS DISTINCT FROM p_cipher
       AND summary NOT LIKE p_current_prefix || '%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION vc.conversation_summary_stored_text(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.conversation_summary_stored_text(bigint, bigint) TO vc_api;
REVOKE ALL ON FUNCTION vc.backfill_stale_cipher_summary_batch(bigint, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.backfill_stale_cipher_summary_batch(bigint, int, text) TO vc_api;
REVOKE ALL ON FUNCTION vc.backfill_replace_summary_cipher(bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.backfill_replace_summary_cipher(bigint, bigint, text, text) TO vc_api;
