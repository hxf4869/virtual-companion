-- TASK-0158 V18: SECURITY DEFINER search_path hardened to vc,pg_catalog and
-- CREATE revoked on schema public from PUBLIC (RISK-09).
--
-- RISK-09 (docs/evidence/TASK-0109/zcode-remediation-handoff.md §5.1 item 5 and
-- §5.3 conditional release-gate row): every SECURITY DEFINER function in schema
-- vc previously declared `SET search_path = vc, public`. Because these bodies
-- execute with the owner's privileges, an untrusted role able to CREATE objects
-- in `public` could plant a same-named shadow object reachable through the
-- `public` entry of the search_path and hijack unqualified resolution inside a
-- privileged body (object hijacking). This migration:
--
--   1. Rewrites the SET search_path clause of every SECURITY DEFINER function in
--      schema vc to `vc, pg_catalog` (public removed), via ALTER FUNCTION driven
--      by a pg_proc introspection loop. This covers all 37 SD functions:
--      the 34 redefined by V17 plus the 3 inline-clause V5 helpers
--      (complete_work_item / fail_work_item / cancel_work_item) that V17 left
--      untouched. Function signatures, bodies, LANGUAGE, SECURITY DEFINER, owner,
--      GRANTs and RLS are unchanged.
--   2. REVOKEs CREATE on schema public FROM PUBLIC, so no role can ever plant a
--      shadow object in the only non-vc entry the SD search_path ever carried.
--
-- Flyway-safe: no prior migration (V1..V17) is edited, so no checksum is broken.
-- The header below binds only this script's own DDL session; it does not persist
-- to runtime (each SD function carries its own hardened SET clause after step 1).

SET search_path TO vc, pg_catalog;

-- ============================================================================
-- 1. Harden every SECURITY DEFINER function in schema vc to search_path = vc, pg_catalog.
-- ============================================================================
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT p.proname,
               pg_get_function_identity_arguments(p.oid) AS ident_args
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'vc'
           AND p.prosecdef = true
    LOOP
        -- ALTER FUNCTION ... SET updates the function's proconfig entry in place,
        -- replacing the prior search_path=vc, public with search_path=vc, pg_catalog.
        EXECUTE format(
            'ALTER FUNCTION vc.%s(%s) SET search_path = vc, pg_catalog',
            quote_ident(r.proname),
            r.ident_args
        );
    END LOOP;
END $$;

-- ============================================================================
-- 2. Revoke CREATE on schema public from PUBLIC.
-- ============================================================================
-- Idempotent defense-in-depth: on PostgreSQL >= 15 the public schema no longer
-- grants CREATE to PUBLIC by default, but this explicit REVOKE guarantees the
-- property regardless of initdb flags, cluster version or future migrations, and
-- makes it machine-assertable (the cross-tenant suite verifies runtime roles and
-- PUBLIC cannot CREATE in public). REVOKE of an un-held privilege is a no-op.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
