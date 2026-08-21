-- REVIEW-FIX (download token at rest): download_token was stored and compared
-- in plaintext, so anyone able to read export_request (backup leak, injection,
-- an over-broad future GRANT) held a working download secret until it was
-- consumed or expired. Following the V8 realtime-ticket pattern the token is
-- now issued ONCE at create time -- the caller sees the plaintext only in the
-- create response -- and only its sha256 hex digest is stored. The status view
-- no longer returns a token, and the download hashes the presented token
-- before comparison. complete_export drops its token parameter (possession
-- now originates at create, not at worker completion).

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.export_request RENAME COLUMN download_token TO download_token_hash;

-- Existing READY rows (local drills only in Alpha): migrate the stored
-- plaintext to its digest so a previously issued download URL keeps working.
UPDATE vc.export_request
   SET download_token_hash = encode(
           vc.digest(convert_to(download_token_hash, 'UTF8'), 'sha256'), 'hex')
 WHERE download_token_hash IS NOT NULL;

-- Signatures change (create gains the token, complete loses it): drop the
-- old identities, then recreate with the V75 guard bodies carried forward.
DROP FUNCTION IF EXISTS vc.create_export_request(bigint);
DROP FUNCTION IF EXISTS vc.complete_export(bigint, bigint, text, text, timestamptz);
-- The OUT row type changes (out_download_token removed): CREATE OR REPLACE
-- cannot alter it, so drop and recreate (grants restored below).
DROP FUNCTION IF EXISTS vc.get_export_request(bigint, bigint);

CREATE OR REPLACE FUNCTION vc.create_export_request(
    p_owner_user_id bigint,
    p_token         text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id   bigint;
    v_pend integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_export_request: owner_user_id is required';
    END IF;
    IF p_token IS NULL OR btrim(p_token) = '' THEN
        RAISE EXCEPTION 'create_export_request: one-time download token is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_export_request: owner_user_id must match server-trusted context';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.create_export_request.inflight'));
    SELECT count(*) INTO v_pend
      FROM vc.export_request e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.status = 'PENDING';
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'create_export_request: an export is already in flight for this account';
    END IF;

    v_id := nextval('vc.export_request_id_seq');
    -- Only the digest is persisted; the plaintext leaves the process exactly
    -- once, in the create response (V8 ticket pattern).
    INSERT INTO vc.export_request(owner_user_id, id, status, download_token_hash)
    VALUES (p_owner_user_id, v_id, 'PENDING',
            encode(vc.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'));

    -- The work item carries the export id as ref_id; the worker never reads
    -- the export row directly (only the SD functions reach the payload).
    PERFORM vc.enqueue_work_item(p_owner_user_id, 'DATA_EXPORT', v_id, NULL);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.complete_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_payload       text,
    p_expires_at    timestamptz
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
    IF p_payload IS NULL THEN
        RAISE EXCEPTION 'complete_export: payload is required';
    END IF;
    IF p_expires_at IS NULL THEN
        RAISE EXCEPTION 'complete_export: expires_at is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'complete_export: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.export_request
       SET status = 'READY',
           completed_at = now(),
           expires_at = p_expires_at,
           payload = p_payload,
           error_message = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Status view: no token column anymore (the digest is not returnable by
-- design); the caller builds the download URL from its create-time token.
CREATE OR REPLACE FUNCTION vc.get_export_request(
    p_owner_user_id bigint,
    p_export_id     bigint
)
    RETURNS TABLE(out_id bigint, out_status text, out_requested_at timestamptz,
                  out_completed_at timestamptz, out_expires_at timestamptz,
                  out_error_message text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_export_request: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'get_export_request: export id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_export_request: owner_user_id must match server-trusted context';
    END IF;
    RETURN QUERY
        SELECT e.id, e.status, e.requested_at, e.completed_at, e.expires_at,
               e.error_message
          FROM vc.export_request e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.id = p_export_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.fail_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_error         text
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
        RAISE EXCEPTION 'fail_export: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'fail_export: export id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'fail_export: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.export_request
       SET status = 'FAILED',
           completed_at = now(),
           error_message = btrim(p_error),
           download_token_hash = NULL,
           payload = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.consume_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_token         text
)
    RETURNS TABLE(out_payload text, out_expires_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_payload    text;
    v_expires_at timestamptz;
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
    UPDATE vc.export_request e
       SET download_token_hash = NULL
     WHERE e.owner_user_id = p_owner_user_id
       AND e.id = p_export_id
       AND e.status = 'READY'
       AND e.download_token_hash = encode(
               vc.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex')
       AND e.download_token_hash IS NOT NULL
       AND e.expires_at > now()
    RETURNING e.payload, e.expires_at INTO v_payload, v_expires_at;
    IF v_payload IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT v_payload, v_expires_at;
END;
$$;

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

-- Closed by default; the dropped identities took their grants with them.
REVOKE EXECUTE ON FUNCTION vc.create_export_request(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_export_request(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.create_export_request(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.get_export_request(bigint, bigint) TO vc_api;
