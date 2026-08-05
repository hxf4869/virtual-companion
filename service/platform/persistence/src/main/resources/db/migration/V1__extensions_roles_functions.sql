-- TASK-0015 V1: extensions, vc schema, minimal-privilege roles and tenant-context helpers.
--
-- Establishes the PostgreSQL 18 + pgvector baseline, the four runtime roles
-- (all NOBYPASSRLS so FORCE RLS can never be escaped by the application), and
-- the transaction-local tenant context plumbing used by every RLS policy.
--
-- Roles created here are the ONLY runtime roles; none carry BYPASSRLS. A
-- migration/admin principal is expected to run Flyway as a privileged user;
-- runtime code connects as one of the vc_* roles below.

-- pgvector provides the embedding type for later memory/recall tasks. The
-- extension is created now so the persistence baseline carries the agreed
-- engine identity (POSTGRESQL_18_WITH_PGVECTOR).
CREATE EXTENSION IF NOT EXISTS vector;

-- Keep all Virtual Companion objects in one dedicated schema.
CREATE SCHEMA IF NOT EXISTS vc;

-- Runtime roles. NOBYPASSRLS is explicit and load-bearing: FORCE ROW LEVEL
-- SECURITY on every owned table must bind these roles unconditionally.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_api') THEN
        CREATE ROLE vc_api NOBYPASSRLS NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_worker') THEN
        CREATE ROLE vc_worker NOBYPASSRLS NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_job_coordinator') THEN
        CREATE ROLE vc_job_coordinator NOBYPASSRLS NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vc_dispatcher') THEN
        CREATE ROLE vc_dispatcher NOBYPASSRLS NOLOGIN;
    END IF;
END $$;

-- Tenant context helpers. The owner predicate reads vc.owner_user_id; every
-- owned table's RLS policy uses vc.current_owner_id(). When the GUC is unset
-- the function returns NULL and the equality predicate matches nothing, so a
-- missing context fails closed instead of leaking rows.
CREATE OR REPLACE FUNCTION vc.current_owner_id()
    RETURNS bigint
    LANGUAGE sql
    STABLE
    AS $$
        SELECT NULLIF(current_setting('vc.owner_user_id', true), '')::bigint
    $$;

-- Worker job-context entry point. A valid (non-empty, non-stale) fence binds
-- the owner for the surrounding transaction; a stale fence leaves the owner
-- unset so subsequent reads fail closed. Full lease/fence lifecycle is the
-- TASK-0016 scope; this skeleton proves the fail-closed baseline.
CREATE OR REPLACE FUNCTION vc.begin_job_context(
    p_owner_user_id bigint,
    p_fence text
)
    RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'owner_user_id is required for job context';
    END IF;
    -- The stale-fence sentinel and empty/missing fences refuse to establish
    -- an owner context. Real lease validation arrives in TASK-0016; the
    -- denial path must already be provable here.
    IF p_fence IS NULL OR btrim(p_fence) = '' OR p_fence = 'STALE' THEN
        RAISE EXCEPTION 'stale or missing job fence refuses owner context';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    PERFORM set_config('vc.job_fence', p_fence, true);
END;
$$;
