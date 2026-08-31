-- ===========================================================================
-- V19: protect the bootstrap ADMIN seed against concurrent races (P2-13).
--
-- V14's identity_admin_seed is idempotent (SELECT existing ADMIN -> no-op that
-- returns its id), but the check-then-insert carries no concurrency guard: two
-- application instances bootstrapping at the same time could both observe
-- "no ADMIN exists", both INSERT, and create multiple bootstrap ADMIN accounts
-- -- a TOCTOU that breaks the single-bootstrap-ADMIN invariant.
--
-- A transaction-scoped advisory lock serializes the check-then-insert: the
-- first caller acquires it, performs the SELECT..INSERT, and returns; any
-- concurrent caller blocks on the lock and then re-runs the SELECT, observes
-- the ADMIN just created, and no-ops with the same id. The lock is released at
-- transaction end with no cross-transaction residue and no deadlock surface
-- (single lock acquisition, no nesting). This is deliberately advisory rather
-- than a partial unique index on role='ADMIN': identity_account_create (V14)
-- lets an ACTIVE ADMIN create further ADMIN accounts via the API, so a hard
-- uniqueness constraint on ADMIN rows would break that capability. The advisory
-- lock only guards the bootstrap path and leaves ADMIN cardinality unrestricted.
--
-- CREATE OR REPLACE preserves the existing GRANT EXECUTE (vc_api) and REVOKE
-- FROM PUBLIC from V14; signature, parameters, return type, SECURITY DEFINER,
-- normalization, INSERT logic and audit event are identical to V14. Only the
-- search_path clause is restated as vc, pg_catalog (matching V18) and one
-- PERFORM pg_advisory_xact_lock line is added. V1-V18 are untouched (migration history
-- checksum safe).
-- ===========================================================================
SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.identity_admin_seed(
    p_username     text,
    p_password_hash text,
    p_display_name text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username    text := lower(btrim(p_username));
    v_account_id  bigint;
BEGIN
    IF v_username = '' THEN
        RAISE EXCEPTION 'identity_admin_seed: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_admin_seed: password_hash is required';
    END IF;
    -- Serialize the bootstrap check-then-insert across concurrent seed calls so
    -- exactly one caller creates the ADMIN and the rest no-op (P2-13).
    PERFORM pg_advisory_xact_lock(hashtext('vc.identity_admin_seed.bootstrap'));
    SELECT id INTO v_account_id
      FROM vc.identity_account
     WHERE role = 'ADMIN'
     ORDER BY id
     LIMIT 1;
    IF FOUND THEN
        RETURN v_account_id;
    END IF;
    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, 'ADMIN', 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);
    RETURN v_account_id;
END;
$$;
