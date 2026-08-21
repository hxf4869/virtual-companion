-- 56_runtime_role_cannot_migrate: P1-11 separation guarantee. Schema
-- management (DDL, roles, migration state) belongs exclusively to the
-- migration principal (in-app Flyway / CI runner with privileged creds);
-- a runtime role (vc_api) must never be able to create or drop schema
-- objects -- including a forged public.flyway_schema_history that could fake
-- migration state -- alter roles or destroy the vc schema. The runtime role
-- keeps executing the narrow SECURITY DEFINER helpers unchanged.

\set ON_ERROR_STOP on

-- Switch to the vc_api runtime role (superuser fixture session).
SET ROLE vc_api;

DO $$
BEGIN
    -- CREATE TABLE in the vc schema: runtime roles have no DDL capability.
    BEGIN
        CREATE TABLE vc.runtime_attempted_table(id bigint);
        RAISE EXCEPTION 'regression: vc_api CREATE TABLE in vc schema succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- Forge the Flyway schema-history table in public: migration state must
    -- never be writable (or creatable) by a runtime role.
    BEGIN
        CREATE TABLE public.flyway_schema_history(version text, success boolean);
        RAISE EXCEPTION 'regression: vc_api forged flyway_schema_history in public';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- CREATE SCHEMA: a runtime role must not extend the catalog.
    BEGIN
        CREATE SCHEMA vc_runtime_attempted;
        RAISE EXCEPTION 'regression: vc_api CREATE SCHEMA succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- ALTER ROLE: role attribute changes are migrator-only.
    BEGIN
        ALTER ROLE vc_api NOLOGIN;
        RAISE EXCEPTION 'regression: vc_api ALTER ROLE succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    -- DROP SCHEMA: must never be able to destroy the tenant schema.
    BEGIN
        DROP SCHEMA vc CASCADE;
        RAISE EXCEPTION 'regression: vc_api DROP SCHEMA vc succeeded';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;

-- Sanity: separation must not break the legitimate runtime call path -- the
-- fail-closed tenant-context helper still exists and returns NULL when no
-- owner context is bound (as postgres; the same function is world-executable
-- and the narrow vc.identity_* SD functions stay granted to vc_api per V14).
RESET ROLE;
DO $$
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'current_owner_id must stay NULL with no owner context';
    END IF;
END $$;
