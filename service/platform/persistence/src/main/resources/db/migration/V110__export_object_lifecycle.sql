-- DOGFOOD-STABILIZATION V110: export object lifecycle invariants.
--
-- Audit fixes over V109 (V109 is already applied in local drill environments
-- and is NOT rewritten; this migration only ADDS functions and narrows one
-- retention predicate):
--
--   fail_export_with_object  PENDING -> FAILED while KEEPING the object
--                           pointer. The worker calls this when the object
--                           upload succeeded but the READY seal failed
--                           (complete_export threw or moved 0 rows): the
--                           bucket object must never become a pointer-less
--                           orphan. The pointer is the durable, retryable
--                           record — the FAILED-object sweep deletes the
--                           bucket object and clears the pointer later.
--   list_failed_export_objects  bounded worklist of FAILED rows that still
--                           carry an object pointer (mirror of
--                           list_expired_export_objects for the FAILED
--                           terminal state).
--   list_owner_export_objects   every row of one owner that still carries an
--                           object pointer (any status). Used by the account
--                           deletion coordinator BEFORE the cascade deletes
--                           the rows: bucket objects must be removed first or
--                           the cascade would destroy the only pointers.
--   retention_purge_export_residue  replaced: terminal rows with a live
--                           object pointer are SKIPPED (object_key IS NULL
--                           required). Deleting such a row directly would
--                           orphan the bucket object. The runtime object
--                           sweeps (EXPIRED/FAILED) delete the object and
--                           clear the pointer first; only then does the row
--                           become purgeable. EXPORT_RESIDUE itself stays
--                           DRAFT — this migration does not activate it.
--
-- All new functions are SECURITY DEFINER with search_path pinned, closed to
-- PUBLIC, granted to vc_api only (V109 cross-owner maintenance pattern).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- fail_export_with_object: durable pointer-preserving failure terminal.
-- Owner-context checked like complete_export (called from the owner-bound
-- worker transaction). Returns rows affected (1 kept pointer; 0 = absent,
-- foreign or no longer PENDING — the caller then falls back to object
-- compensation delete).
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.fail_export_with_object(
    p_owner_user_id bigint,
    p_export_id     bigint,
    p_object_key    text,
    p_object_bytes  bigint,
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
        RAISE EXCEPTION 'fail_export_with_object: owner_user_id is required';
    END IF;
    IF p_export_id IS NULL OR p_export_id <= 0 THEN
        RAISE EXCEPTION 'fail_export_with_object: export id is required';
    END IF;
    IF p_object_key IS NULL OR btrim(p_object_key) = '' THEN
        RAISE EXCEPTION 'fail_export_with_object: object_key is required';
    END IF;
    IF p_object_bytes IS NULL OR p_object_bytes < 0 THEN
        RAISE EXCEPTION 'fail_export_with_object: object_bytes must be non-negative';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'fail_export_with_object: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.export_request
       SET status = 'FAILED',
           error_message = COALESCE(NULLIF(btrim(p_error), ''), 'export failed'),
           object_key = p_object_key,
           object_bytes = p_object_bytes
     WHERE owner_user_id = p_owner_user_id
       AND id = p_export_id
       AND status = 'PENDING';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_failed_export_objects: bounded FAILED-with-pointer worklist for the
-- object sweep (cross-owner maintenance function, V109 pattern).
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.list_failed_export_objects()
    RETURNS TABLE(out_owner_user_id bigint, out_id bigint, out_object_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
        SELECT e.owner_user_id, e.id, e.object_key
          FROM vc.export_request e
         WHERE e.status = 'FAILED'
           AND e.object_key IS NOT NULL
         ORDER BY e.id
         LIMIT 100;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_owner_export_objects: every pointer-carrying row of one owner, for the
-- pre-cascade account-deletion cleanup (cross-owner maintenance function).
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.list_owner_export_objects(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_owner_user_id bigint, out_id bigint, out_object_key text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_owner_export_objects: owner_user_id is required';
    END IF;
    RETURN QUERY
        SELECT e.owner_user_id, e.id, e.object_key
          FROM vc.export_request e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.object_key IS NOT NULL
         ORDER BY e.id
         LIMIT 500;
END;
$$;

-- ---------------------------------------------------------------------------
-- retention_purge_export_residue (replaced): never delete a row whose bucket
-- object pointer is still live. The runtime sweeps delete the object and
-- clear the pointer; a row becomes purgeable only after that.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.retention_purge_export_residue(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_export_residue: cutoff is required'; END IF;
    DELETE FROM vc.export_request x WHERE x.requested_at < p_cutoff
      AND x.status IN ('READY', 'FAILED', 'EXPIRED')
      AND x.object_key IS NULL
      AND NOT vc.retention_owner_held(x.owner_user_id, 'EXPORT_RESIDUE');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.fail_export_with_object(bigint, bigint, text, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_failed_export_objects() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_owner_export_objects(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_export_residue(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.fail_export_with_object(bigint, bigint, text, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_failed_export_objects() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_owner_export_objects(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.retention_purge_export_residue(timestamptz) TO vc_api;
