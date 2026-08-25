-- DOGFOOD-02 (ADR-0006 §7.3) V109: local MinIO object storage for exports.
--
-- The export document may now live in a private bucket instead of the inline
-- payload column. Two nullable columns record the object pointer:
--   object_key   e.g. exports/{ownerUserId}/{exportId}.json
--   object_bytes uploaded size (informational; lets ops compare DB vs bucket)
-- The document is either inline (payload set, object_key NULL — the previous
-- behavior, fully preserved) or object-backed (payload NULL, object_key set).
-- RLS is unchanged: the new columns inherit the V42 owner_isolation policy and
-- are only reachable through the SD functions below.
--
-- Function changes:
--   complete_export  gains optional p_object_key/p_object_bytes (DEFAULT
--                    NULL), so the inline 4-argument call shape keeps working.
--                    payload and object_key are mutually exclusive and one of
--                    them is required.
--   consume_export   now also returns the object pointer (out_object_key/
--                    out_object_bytes) so the runtime can serve and then
--                    delete the object. Hit detection switched from
--                    "payload IS NULL" to ROW_COUNT — an object-mode row has a
--                    NULL payload but was still consumed. Token one-time
--                    semantics are untouched (the digest is still nulled in
--                    the same UPDATE).
--   expire_stale_exports  unchanged statement (payload/token purge); it never
--                    touches object_key — the object itself is deleted by the
--                    application layer, which then calls clear_export_object.
--   list_expired_export_objects / clear_export_object  (new) sweep pair:
--                    list returns EXPIRED rows that still carry an object
--                    (bounded); clear clears the pointer columns after the
--                    object was removed (CAS on the exact object_key). Both
--                    are cross-owner maintenance functions (V42
--                    expire_stale_exports pattern) granted to vc_api only.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.export_request
    ADD COLUMN object_key   text,
    ADD COLUMN object_bytes bigint;

-- ---------------------------------------------------------------------------
-- complete_export: seal PENDING as READY with either the inline payload or
-- the object pointer. Returns rows affected (1 success; 0 = absent, foreign
-- or no longer PENDING).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.complete_export(bigint, bigint, text, timestamptz);
CREATE OR REPLACE FUNCTION vc.complete_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_payload       text,
    p_expires_at    timestamptz,
    p_object_key    text DEFAULT NULL,
    p_object_bytes  bigint DEFAULT NULL
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'complete_export: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'complete_export: export id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'complete_export: owner_user_id must match server-trusted context';
    END IF;
    -- Exactly one storage mode: inline payload XOR object pointer.
    IF p_payload IS NULL AND p_object_key IS NULL THEN
        RAISE EXCEPTION 'complete_export: payload or object_key is required';
    END IF;
    IF p_payload IS NOT NULL AND p_object_key IS NOT NULL THEN
        RAISE EXCEPTION 'complete_export: payload and object_key are mutually exclusive';
    END IF;
    IF p_object_key IS NOT NULL AND (p_object_bytes IS NULL OR p_object_bytes < 0) THEN
        RAISE EXCEPTION 'complete_export: object_bytes is required with object_key';
    END IF;
    IF p_expires_at IS NULL THEN
        RAISE EXCEPTION 'complete_export: expires_at is required';
    END IF;

    UPDATE vc.export_request
       SET status = 'READY',
           completed_at = now(),
           expires_at = p_expires_at,
           payload = p_payload,
           object_key = p_object_key,
           object_bytes = p_object_bytes,
           error_message = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- consume_export: one-time download. Returns the inline payload and/or the
-- object pointer plus the expiry exactly once — the token digest is nulled in
-- the same statement, and only a READY, unexpired, token-matching row
-- qualifies. Zero rows means consumed, expired, absent or foreign (existence
-- undisclosed).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.consume_export(bigint, bigint, text);
CREATE OR REPLACE FUNCTION vc.consume_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_token         text
)
    RETURNS TABLE(out_payload text, out_object_key text, out_object_bytes bigint,
                  out_expires_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_payload      text;
    v_object_key   text;
    v_object_bytes bigint;
    v_expires_at   timestamptz;
    v_rows         integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'consume_export: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'consume_export: export id is required';
    END IF;
    IF p_token IS NULL OR btrim(p_token) = '' THEN
        RAISE EXCEPTION 'consume_export: token is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'consume_export: owner_user_id must match server-trusted context';
    END IF;

    -- One-time semantics: the UPDATE consumes the token atomically; a second
    -- call (or an expired row) matches zero rows. The presented plaintext is
    -- digested for comparison — the stored value is never the secret itself.
    -- ROW_COUNT (not "payload IS NULL") decides the hit: object-mode rows
    -- carry a NULL payload by design.
    UPDATE vc.export_request e
       SET download_token_hash = NULL
     WHERE e.owner_user_id = p_owner_user_id
       AND e.id = p_export_id
       AND e.status = 'READY'
       AND e.download_token_hash = encode(
               vc.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
       AND e.download_token_hash IS NOT NULL
       AND e.expires_at > now()
    RETURNING e.payload, e.object_key, e.object_bytes, e.expires_at
        INTO v_payload, v_object_key, v_object_bytes, v_expires_at;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT v_payload, v_object_key, v_object_bytes, v_expires_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- expire_stale_exports: statement unchanged — READY rows past expiry become
-- EXPIRED with payload and token purged. object_key/object_bytes are
-- deliberately kept so the application sweep can still find and delete the
-- bucket object (deletion is NOT complete until clear_export_object ran).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.expire_stale_exports()
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    UPDATE vc.export_request
       SET status = 'EXPIRED',
           download_token_hash = NULL,
           payload = NULL
     WHERE status = 'READY'
       AND expires_at IS NOT NULL
       AND expires_at <= now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_expired_export_objects: bounded worklist for the application sweep —
-- EXPIRED rows whose bucket object still needs deletion. Cross-owner
-- maintenance function (expire_stale_exports pattern).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_expired_export_objects()
    RETURNS TABLE(out_owner_user_id bigint, out_id bigint, out_object_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT e.owner_user_id, e.id, e.object_key
          FROM vc.export_request e
         WHERE e.status = 'EXPIRED'
           AND e.object_key IS NOT NULL
         ORDER BY e.id
         LIMIT 100;
END;
$$;

-- ---------------------------------------------------------------------------
-- clear_export_object: called by the application AFTER the bucket object was
-- deleted (either post-download or by the expiry sweep). The object_key
-- comparison is a CAS against the pointer the caller acted on, so a retry or
-- a concurrently re-sealed row can never be wiped by mistake. Cross-owner
-- maintenance function. Returns rows affected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.clear_export_object(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_object_key    text
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'clear_export_object: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'clear_export_object: export id is required';
    END IF;
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'clear_export_object: object_key is required';
    END IF;

    UPDATE vc.export_request
       SET object_key = NULL,
           object_bytes = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND object_key = p_object_key;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Closed by default; the dropped identities took their grants with them.
REVOKE EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz, text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.consume_export(bigint, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_expired_export_objects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.clear_export_object(bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz, text, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.consume_export(bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_expired_export_objects() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.clear_export_object(bigint, bigint, text) TO vc_api;
