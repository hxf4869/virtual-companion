-- S0-17-B: checkpoint re-encrypt helpers for generic key id/version.
--
-- V71 still converts pre-encryption plaintext into the historical enc1:
-- form. After RestFieldCipher single-writes enc2:<keyId>:<version>:, a
-- rotation/backfill must rewrite plaintext AND enc1 AND stale enc2 rows
-- without the database ever holding the key. These helpers take the
-- current write prefix from the application (e.g. enc2:default:1:) so a
-- later key version is the same SQL path.
--
-- conversation_summary is intentionally not in this migration (S0-32).

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.backfill_stale_cipher_message_batch(
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
        RAISE EXCEPTION 'backfill_stale_cipher_message_batch: after_id is required';
    END IF;
    IF p_current_prefix IS NULL
       OR left(p_current_prefix, 5) <> 'enc2:'
       OR right(p_current_prefix, 1) <> ':' THEN
        RAISE EXCEPTION 'backfill_stale_cipher_message_batch: current prefix must be enc2:<keyId>:<version>:';
    END IF;
    RETURN QUERY
    SELECT m.owner_user_id, m.id, m.content
      FROM vc.message m
     WHERE m.id > p_after_id
       AND m.content IS NOT NULL
       AND m.content NOT LIKE p_current_prefix || '%'
     ORDER BY m.id
     LIMIT v_limit;
END;
$$;

CREATE FUNCTION vc.backfill_replace_message_cipher(
    p_owner_user_id   bigint,
    p_message_id      bigint,
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
    IF p_owner_user_id IS NULL OR p_message_id IS NULL
       OR p_cipher IS NULL OR p_current_prefix IS NULL THEN
        RAISE EXCEPTION 'backfill_replace_message_cipher: all arguments are required';
    END IF;
    IF left(p_current_prefix, 5) <> 'enc2:'
       OR right(p_current_prefix, 1) <> ':' THEN
        RAISE EXCEPTION 'backfill_replace_message_cipher: current prefix must be enc2:<keyId>:<version>:';
    END IF;
    IF left(p_cipher, length(p_current_prefix)) IS DISTINCT FROM p_current_prefix THEN
        RAISE EXCEPTION 'backfill_replace_message_cipher: cipher must carry the current write prefix';
    END IF;
    UPDATE vc.message
       SET content = p_cipher
     WHERE owner_user_id = p_owner_user_id
       AND id = p_message_id
       AND content IS DISTINCT FROM p_cipher
       AND content NOT LIKE p_current_prefix || '%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION vc.backfill_stale_cipher_message_batch(bigint, int, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.backfill_stale_cipher_message_batch(bigint, int, text) TO vc_api;
REVOKE ALL ON FUNCTION vc.backfill_replace_message_cipher(bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.backfill_replace_message_cipher(bigint, bigint, text, text) TO vc_api;
