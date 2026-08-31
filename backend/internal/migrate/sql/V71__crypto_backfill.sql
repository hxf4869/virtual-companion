-- CRYPTO-REST V71: one-shot backfill support for at-rest encryption.
--
-- Encryption happens in the application layer (RestFieldCipher), so the
-- migration cannot encrypt anything by itself — the key never enters the
-- database. These two SECURITY DEFINER helpers let the runtime backfill
-- runner (virtual-companion.crypto.backfill-enabled=true) convert legacy
-- plaintext message bodies in batches:
--   backfill_plain_message_batch: keyset page of rows whose content lacks
--     the "enc1:" prefix (plaintext, pre-encryption rows);
--   backfill_encrypt_message_content: conditional update that only replaces
--     a STILL-plaintext value (idempotent; a concurrently re-encrypted row
--     is skipped, reported as false).
-- Runtime roles get EXECUTE only — no table-level UPDATE ever granted.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.backfill_plain_message_batch(
    p_after_id bigint,
    p_limit    int
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
        RAISE EXCEPTION 'backfill_plain_message_batch: after_id is required';
    END IF;
    RETURN QUERY
    SELECT m.owner_user_id, m.id, m.content
      FROM vc.message m
     WHERE m.id > p_after_id
       AND m.content NOT LIKE 'enc1:%'
     ORDER BY m.id
     LIMIT v_limit;
END;
$$;

CREATE FUNCTION vc.backfill_encrypt_message_content(
    p_owner_user_id bigint,
    p_message_id    bigint,
    p_cipher        text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_updated int;
BEGIN
    IF p_owner_user_id IS NULL OR p_message_id IS NULL OR p_cipher IS NULL THEN
        RAISE EXCEPTION 'backfill_encrypt_message_content: all arguments are required';
    END IF;
    IF left(p_cipher, 5) <> 'enc1:' THEN
        RAISE EXCEPTION 'backfill_encrypt_message_content: cipher must carry the enc1: prefix';
    END IF;
    UPDATE vc.message
       SET content = p_cipher
     WHERE owner_user_id = p_owner_user_id
       AND id = p_message_id
       AND content NOT LIKE 'enc1:%';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION vc.backfill_plain_message_batch(bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.backfill_plain_message_batch(bigint, int) TO vc_api;
REVOKE ALL ON FUNCTION vc.backfill_encrypt_message_content(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.backfill_encrypt_message_content(bigint, bigint, text) TO vc_api;
