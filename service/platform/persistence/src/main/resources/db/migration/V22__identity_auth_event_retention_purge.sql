-- TASK-0034 V22: identity_auth_event retention purge.
--
-- P2-03 audit retention (Owner 2026-08-12 decision: retain 180 days with an
-- automated scheduled purge). identity_auth_event (V14) is an append-only audit
-- trail (LOGIN_SUCCESS/LOGIN_FAILURE/LOGOUT/ACCOUNT_CREATE) that never stores a
-- password, raw token or token hash -- only the event, the account id and the
-- username. It grows without bound: the runtime role vc_api has no table-level
-- DML on it (V14 REVOKE ALL) and only EXECUTE on the SECURITY DEFINER INSERT
-- functions, so without a controlled purge boundary the audit rows accumulate
-- forever.
--
-- This migration adds a single SECURITY DEFINER purge function that deletes
-- audit events older than a caller-supplied cutoff (normally now() minus the
-- configured retention window). SECURITY DEFINER executes the DELETE as the
-- function owner (the migration principal) so vc_api never needs a table-level
-- DELETE grant: the runtime application role gains only EXECUTE on this one
-- function, whose body is fixed to delete solely by occurred_at age. A NULL
-- cutoff fails closed (it never deletes everything), and the operation is
-- idempotent -- re-running it with the same cutoff removes zero additional
-- rows. The runtime calls this daily via @Scheduled (see
-- IdentityAuthEventPurgeScheduler).
--
-- No existing migration is modified (Flyway checksum safe) and no existing
-- function signature or body is touched (this is a brand-new CREATE FUNCTION,
-- so V18's apply-time search_path rewrite of the older SECURITY DEFINER
-- functions is not re-applied). The new function self-declares
-- SET search_path = vc, pg_catalog to match the V18 hardened baseline.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- identity_auth_event_purge: delete audit events older than the cutoff and
-- return the number of rows removed. SECURITY DEFINER runs the DELETE under the
-- function owner because vc_api holds no DELETE privilege on the audit table.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.identity_auth_event_purge(
    p_cutoff timestamptz
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'identity_auth_event_purge: cutoff is required';
    END IF;
    DELETE FROM vc.identity_auth_event
     WHERE occurred_at < p_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: only the runtime application role may execute the purge; PUBLIC
-- is revoked (defensive, mirroring the V14 convention). No table-level DELETE is
-- granted to any runtime role -- the SECURITY DEFINER boundary is the sole path.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION vc.identity_auth_event_purge(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_auth_event_purge(timestamptz) TO vc_api;
