-- ENT-SNAP V40: simulated entitlement snapshots (A3-001 / FR-ENT-004).
--
-- Alpha entitlement = an ADMIN-assigned service class per test account
-- (ECONOMY / PREMIUM), stored in vc.service_class_assignment (a platform
-- table in the V31 identity pattern: no RLS, every access through ADMIN-only
-- SECURITY DEFINER functions).
--
-- Every generation turn mints ONE immutable vc.entitlement_snapshot row bound
-- to the generation (UNIQUE owner+generation): retries of the same logical
-- generation resolve the SAME snapshot (FR-ENT-004 "同一轮生成和重试必须引用
-- 同一权益快照"), and the row survives as routing audit (joinable to
-- generation_route / attempts). The snapshot copies the assignment's class at
-- mint time, so a later reassignment never rewrites history.
--
-- The worker mints through the SD inside the guarded prepare transaction; the
-- runtime role never writes the table directly (V16 posture).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- service_class_assignment: ADMIN-set tier per account (ECONOMY / PREMIUM).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc.service_class_assignment (
    owner_user_id  bigint      NOT NULL,
    service_class  text        NOT NULL,
    assigned_by    bigint      NOT NULL,
    assigned_at    timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id),
    CONSTRAINT service_class_assignment_class_check
        CHECK (service_class IN ('ECONOMY', 'PREMIUM'))
);

-- ---------------------------------------------------------------------------
-- entitlement_snapshot: immutable per-generation entitlement snapshot.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.entitlement_snapshot_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.entitlement_snapshot_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE TABLE IF NOT EXISTS vc.entitlement_snapshot (
    owner_user_id  bigint      NOT NULL,
    id             bigint      NOT NULL,
    generation_id  bigint      NOT NULL,
    service_class  text        NOT NULL,
    source         text        NOT NULL DEFAULT 'ADMIN_ASSIGNMENT',
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, generation_id),
    CONSTRAINT entitlement_snapshot_class_check
        CHECK (service_class IN ('ECONOMY', 'PREMIUM'))
);

ALTER TABLE vc.entitlement_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.entitlement_snapshot FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.entitlement_snapshot;
CREATE POLICY owner_isolation ON vc.entitlement_snapshot FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- ---------------------------------------------------------------------------
-- assign_service_class: ADMIN-only upsert of one account's tier.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.assign_service_class(
    p_acting_account_id bigint,
    p_target_account_id bigint,
    p_service_class     text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'assign_service_class: acting account is required';
    END IF;
    IF p_target_account_id IS NULL OR p_target_account_id <= 0 THEN
        RAISE EXCEPTION 'assign_service_class: target account is required';
    END IF;
    IF p_service_class NOT IN ('ECONOMY', 'PREMIUM') THEN
        RAISE EXCEPTION 'assign_service_class: class must be ECONOMY or PREMIUM';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'assign_service_class: caller is not an active ADMIN';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_target_account_id) THEN
        RAISE EXCEPTION 'assign_service_class: target account not found';
    END IF;

    INSERT INTO vc.service_class_assignment
        (owner_user_id, service_class, assigned_by, assigned_at, updated_at)
    VALUES
        (p_target_account_id, p_service_class, p_acting_account_id, now(), now())
    ON CONFLICT (owner_user_id) DO UPDATE
        SET service_class = EXCLUDED.service_class,
            assigned_by   = EXCLUDED.assigned_by,
            updated_at    = now();
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_service_class_assignments: ADMIN-only registry of assigned tiers.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_service_class_assignments(
    p_acting_account_id bigint
)
    RETURNS TABLE(out_account_id bigint, out_username text,
                  out_service_class text, out_assigned_at timestamptz,
                  out_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'list_service_class_assignments: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'list_service_class_assignments: caller is not an active ADMIN';
    END IF;
    RETURN QUERY
        SELECT a.id, a.username, COALESCE(s.service_class, 'ECONOMY'),
               s.assigned_at, s.updated_at
          FROM vc.identity_account a
          LEFT JOIN vc.service_class_assignment s ON s.owner_user_id = a.id
         ORDER BY a.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- mint_entitlement_snapshot: trusted-owner, idempotent per generation.
-- Unassigned accounts mint ECONOMY (the Alpha default). Retries of the same
-- generation resolve the existing snapshot (FR-ENT-004).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.mint_entitlement_snapshot(
    p_owner_user_id bigint,
    p_generation_id bigint
)
    RETURNS TABLE(out_id bigint, out_service_class text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_class text := 'ECONOMY';
    v_id    bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: generation id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: owner_user_id must match server-trusted context';
    END IF;

    -- Always exactly one row (the LEFT JOIN carries the owner id): a missing
    -- assignment falls back to ECONOMY, and a plain non-STRICT SELECT INTO
    -- would null the target on zero rows.
    SELECT COALESCE(s.service_class, 'ECONOMY') INTO v_class
      FROM (SELECT p_owner_user_id AS owner_user_id) o
      LEFT JOIN vc.service_class_assignment s
        ON s.owner_user_id = o.owner_user_id;

    v_id := nextval('vc.entitlement_snapshot_id_seq');
    INSERT INTO vc.entitlement_snapshot
        (owner_user_id, id, generation_id, service_class, source)
    VALUES
        (p_owner_user_id, v_id, p_generation_id, v_class, 'ADMIN_ASSIGNMENT')
    ON CONFLICT (owner_user_id, generation_id) DO NOTHING;

    SELECT e.id, e.service_class INTO v_id, v_class
      FROM vc.entitlement_snapshot e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.generation_id = p_generation_id;
    RETURN QUERY SELECT v_id, v_class;
END;
$$;

-- Closed by default: admin ops to vc_api; the mint also runs from the worker
-- pool (the assembler mints inside the guarded prepare segment).
REVOKE EXECUTE ON FUNCTION vc.assign_service_class(bigint, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_service_class_assignments(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.mint_entitlement_snapshot(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.assign_service_class(bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.list_service_class_assignments(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.mint_entitlement_snapshot(bigint, bigint) TO vc_api, vc_worker;
