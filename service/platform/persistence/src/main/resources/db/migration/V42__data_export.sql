-- DATA-EXPORT V42: asynchronous user data export (FR-DATA-002).
--
-- Alpha minimal shape: POST /api/v1/exports enqueues a DATA_EXPORT work item
-- through vc.create_export_request (reusing the V5/V25 worker queue); the
-- worker builds the JSON document (conversations + messages with AI-content
-- markers, memories, reminders, consents) and seals it with
-- vc.complete_export (short-lived one-time download token). The token is
-- consumed exactly once by vc.consume_export; expired READY rows are swept to
-- EXPIRED with the payload nulled (自动删除对象存储文件 — Technical Alpha
-- stores the payload inline, so deletion means payload/token purge) by
-- vc.expire_stale_exports on a runtime schedule. Every user-scoped function
-- re-verifies the V17 trusted-owner context and is callable only by vc_api.
--
-- The create function refuses a second request while one is PENDING (one
-- in-flight export per account), so the queue cannot be flooded.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.export_request_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.export_request_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.export_request (
    owner_user_id  bigint      NOT NULL,
    id             bigint      NOT NULL,
    status         text        NOT NULL DEFAULT 'PENDING',
    requested_at   timestamptz NOT NULL DEFAULT now(),
    completed_at   timestamptz,
    expires_at     timestamptz,
    download_token text,
    payload        text,
    error_message  text,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT export_request_status CHECK (
        status IN ('PENDING', 'READY', 'FAILED', 'EXPIRED'))
);

ALTER TABLE vc.export_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.export_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.export_request;
CREATE POLICY owner_isolation ON vc.export_request FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- ---------------------------------------------------------------------------
-- create_export_request: insert a PENDING export row and enqueue the
-- DATA_EXPORT work item that the worker later seals. Returns the export id.
-- One in-flight export per account: a second request while a PENDING export
-- exists RAISEs (the caller pre-checks and maps it to 400).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_export_request(
    p_owner_user_id bigint
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
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_export_request: owner_user_id must match server-trusted context';
    END IF;

    SELECT count(*) INTO v_pend
      FROM vc.export_request e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.status = 'PENDING';
    IF v_pend > 0 THEN
        RAISE EXCEPTION 'create_export_request: an export is already in flight for this account';
    END IF;

    v_id := nextval('vc.export_request_id_seq');
    INSERT INTO vc.export_request(owner_user_id, id, status)
    VALUES (p_owner_user_id, v_id, 'PENDING');

    -- The work item carries the export id as ref_id; the worker never reads
    -- the export row directly (only the SD functions reach the payload).
    PERFORM vc.enqueue_work_item(p_owner_user_id, 'DATA_EXPORT', v_id, NULL);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- count_inflight_exports: eager pre-check for the create endpoint (one
-- in-flight export per account maps to 400 before the SD guard runs).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.count_inflight_exports(
    p_owner_user_id bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'count_inflight_exports: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'count_inflight_exports: owner_user_id must match server-trusted context';
    END IF;
    RETURN (SELECT count(*)::integer
              FROM vc.export_request e
             WHERE e.owner_user_id = p_owner_user_id
               AND e.status = 'PENDING');
END;
$$;

-- ---------------------------------------------------------------------------
-- complete_export: seal a PENDING export as READY with its payload, a fresh
-- one-time download token and the download expiry. Returns rows affected
-- (1 on success; 0 means the request is absent, foreign or no longer PENDING
-- — the worker treats 0 as a terminal error and fails the work item).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.complete_export(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_payload       text,
    p_token         text,
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
    IF p_payload IS NULL OR p_token IS NULL OR btrim(p_token) = '' THEN
        RAISE EXCEPTION 'complete_export: payload and token are required';
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
           download_token = p_token,
           payload = p_payload,
           error_message = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- fail_export: terminalize a PENDING export as FAILED with a stable error
-- message (no user content). Returns rows affected.
-- ---------------------------------------------------------------------------
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
           download_token = NULL,
           payload = NULL
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_export_request: status view for the owner. Includes the download token
-- so the runtime can build the short-lived one-time downloadUrl; never the
-- payload. A foreign or absent id yields zero rows (existence undisclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_export_request(
    p_owner_user_id bigint,
    p_export_id     bigint
)
    RETURNS TABLE(out_id bigint, out_status text, out_requested_at timestamptz,
                  out_completed_at timestamptz, out_expires_at timestamptz,
                  out_error_message text, out_download_token text)
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
               e.error_message, e.download_token
          FROM vc.export_request e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.id = p_export_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- consume_export: one-time download. Returns the payload (and expiry) exactly
-- once — the token is nulled in the same statement, and only a READY,
-- unexpired, token-matching row qualifies. Zero rows means consumed, expired,
-- absent or foreign (existence undisclosed).
-- ---------------------------------------------------------------------------
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
    -- call (or an expired row) matches zero rows.
    UPDATE vc.export_request e
       SET download_token = NULL
     WHERE e.owner_user_id = p_owner_user_id
       AND e.id = p_export_id
       AND e.status = 'READY'
       AND e.download_token = p_token
       AND e.download_token IS NOT NULL
       AND e.expires_at > now()
    RETURNING e.payload, e.expires_at INTO v_payload, v_expires_at;
    IF v_payload IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY SELECT v_payload, v_expires_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- expire_stale_exports: the scheduled sweep (FR-DATA-002 过期后自动删除).
-- READY rows past their expiry become EXPIRED with payload and token purged.
-- Cross-owner maintenance function (no owner context required; granted to
-- vc_api like the V24 queue-maintenance functions). Returns rows affected.
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
           download_token = NULL,
           payload = NULL
     WHERE status = 'READY'
       AND expires_at IS NOT NULL
       AND expires_at <= now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Closed by default: only the API ingestion role reaches export records.
REVOKE EXECUTE ON FUNCTION vc.create_export_request(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.count_inflight_exports(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.fail_export(bigint, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_export_request(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.consume_export(bigint, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.expire_stale_exports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.create_export_request(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.count_inflight_exports(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.complete_export(bigint, bigint, text, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.fail_export(bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.get_export_request(bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.consume_export(bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.expire_stale_exports() TO vc_api;
