-- 127_runtime_roles_ddl_fail_closed: S0-27 decision-independent hardening.
-- The existing negatives are per-principal incomplete: test 56 proves DDL
-- denial for vc_api only, test 53 pins NOBYPASSRLS+NOLOGIN, test 57 pins
-- CREATE-on-public for vc_api/vc_worker. This test closes the drift surface
-- for ALL FOUR migration-created runtime roles:
--   A. no privileged attribute beyond 53: SUPERUSER/CREATEROLE/CREATEDB/
--      REPLICATION must stay off (BYPASSRLS/LOGIN stay covered by 53/V16);
--   B. leaf principals: no membership in any other role, so an operator
--      cannot silently widen a runtime role through role inheritance;
--   C. no CREATE on schema vc nor public (extends 57 G2 from two roles to
--      four and adds the business schema itself);
--   D. live CREATE/ALTER/DROP denial probes mirroring test 56, executed as
--      each runtime role, so the acceptance line "runtime 无法
--      CREATE/ALTER/DROP、跨 owner 或读取受保护凭据" is proven per principal,
--      not just for vc_api.
--
-- Decision-independent by construction: every assertion constrains only the
-- NOLOGIN roles created by V1/V16, so it holds under ANY operator LOGIN-role
-- scheme (single shared login, per-service logins, or a dedicated migrator
-- principal) and needs no Owner deployment decision.
--
-- Auto-picked by infra/db/run-rls-tests.sh ([0-9][0-9]*_*.sql glob).

\set ON_ERROR_STOP on

-- ===========================================================================
-- A/B/C: catalog assertions for every runtime role.
-- ===========================================================================
DO $$
DECLARE
    roles     text[] := ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher'];
    r         text;
    n_members int;
BEGIN
    FOREACH r IN ARRAY roles LOOP
        -- A. Privileged attributes must stay off (53 covers BYPASSRLS/NOLOGIN).
        IF EXISTS (
            SELECT 1 FROM pg_roles
             WHERE rolname = r
               AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication)
        ) THEN
            RAISE EXCEPTION 'runtime role % must not hold superuser/createrole/createdb/replication', r;
        END IF;

        -- B. Leaf principal: zero inherited memberships.
        SELECT count(*) INTO n_members
          FROM pg_auth_members m
          JOIN pg_roles member ON member.oid = m.member
         WHERE member.rolname = r;
        IF n_members <> 0 THEN
            RAISE EXCEPTION 'runtime role % must be a leaf principal but holds % role memberships', r, n_members;
        END IF;

        -- C. No CREATE on either schema.
        IF has_schema_privilege(r, 'vc', 'CREATE') THEN
            RAISE EXCEPTION 'runtime role % must NOT have CREATE on schema vc', r;
        END IF;
        IF has_schema_privilege(r, 'public', 'CREATE') THEN
            RAISE EXCEPTION 'runtime role % must NOT have CREATE on schema public', r;
        END IF;
    END LOOP;
END $$;

-- ===========================================================================
-- D: live denial probes per runtime role (mirrors test 56's probe set).
-- Each probe must fail with SQLSTATE 42501 (insufficient_privilege); a
-- success raises the tagged regression error, which no handler catches, so
-- ON_ERROR_STOP fails the suite.
-- ===========================================================================
DO $$
DECLARE
    roles text[] := ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher'];
    r     text;
BEGIN
    FOREACH r IN ARRAY roles LOOP
        EXECUTE format('SET ROLE %I', r);

        -- CREATE TABLE in the tenant schema.
        BEGIN
            EXECUTE format('CREATE TABLE vc.%I__ddl_probe(id bigint)', r);
            RAISE EXCEPTION 'regression: % CREATE TABLE in vc schema succeeded', r;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        -- CREATE SCHEMA: extending the catalog.
        BEGIN
            EXECUTE format('CREATE SCHEMA %I__ddl_probe_schema', r);
            RAISE EXCEPTION 'regression: % CREATE SCHEMA succeeded', r;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        -- ALTER ROLE: role management stays migrator-only.
        BEGIN
            EXECUTE format('ALTER ROLE %I NOLOGIN', r);
            RAISE EXCEPTION 'regression: % ALTER ROLE succeeded', r;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;

        -- DROP SCHEMA: destroying the tenant schema.
        BEGIN
            EXECUTE 'DROP SCHEMA vc CASCADE';
            RAISE EXCEPTION 'regression: % DROP SCHEMA vc succeeded', r;
        EXCEPTION WHEN insufficient_privilege THEN NULL;
        END;
    END LOOP;
END $$;
RESET ROLE;

-- Sanity: the legitimate runtime call path survives all probes unchanged.
DO $$
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'current_owner_id must stay NULL with no owner context';
    END IF;
END $$;
