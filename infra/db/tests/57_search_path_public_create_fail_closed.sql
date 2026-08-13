-- 57_search_path_public_create_fail_closed: RISK-09 hardening (TASK-0158 V18).
-- After V18 every SECURITY DEFINER function in schema vc declares
-- SET search_path = vc, pg_catalog (public removed), and CREATE on schema public
-- is revoked from PUBLIC, so a public-schema shadow object cannot hijack
-- resolution inside a privileged SECURITY DEFINER body.
--
-- G1: every SD function in vc has proconfig search_path = vc, pg_catalog (no public); count >= 37.
-- G2: runtime roles (vc_api/vc_worker) have no CREATE on public (transitively proves PUBLIC lacks it);
--     a live CREATE FUNCTION in public by vc_api is denied.
-- G3: a public same-name FUNCTION shadow cannot hijack an unqualified call inside a
--     vc,pg_catalog SECURITY DEFINER body.

\set ON_ERROR_STOP on

-- ============================================================================
-- G1: every SECURITY DEFINER function in vc hardened to vc, pg_catalog.
-- ============================================================================
DO $$
DECLARE
    n_sd int := 0;
    r     record;
BEGIN
    FOR r IN
        SELECT p.proname,
               pg_get_function_identity_arguments(p.oid) AS ident_args,
               COALESCE(array_to_string(p.proconfig, ','), '') AS cfg
          FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'vc'
           AND p.prosecdef = true
    LOOP
        n_sd := n_sd + 1;
        IF position('search_path=vc, pg_catalog' in r.cfg) = 0 THEN
            RAISE EXCEPTION 'G1: % (%) proconfig lacks search_path=vc, pg_catalog: [%]', r.proname, r.ident_args, r.cfg;
        END IF;
        IF position('public' in r.cfg) <> 0 THEN
            RAISE EXCEPTION 'G1: % (%) proconfig still references public: [%]', r.proname, r.ident_args, r.cfg;
        END IF;
    END LOOP;
    IF n_sd < 37 THEN
        RAISE EXCEPTION 'G1: expected >=37 SECURITY DEFINER functions in vc, found %', n_sd;
    END IF;
END $$;

-- ============================================================================
-- G2: CREATE on schema public is unavailable to runtime roles (and therefore to PUBLIC).
-- vc_api/vc_worker inherit PUBLIC's privileges; if PUBLIC retained CREATE they would
-- have it too. A live CREATE FUNCTION attempt by vc_api must be denied.
-- ============================================================================
DO $$
BEGIN
    IF has_schema_privilege('vc_api', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'G2: vc_api must NOT have CREATE on schema public';
    END IF;
    IF has_schema_privilege('vc_worker', 'public', 'CREATE') THEN
        RAISE EXCEPTION 'G2: vc_worker must NOT have CREATE on schema public';
    END IF;
END $$;

SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        CREATE FUNCTION public.g2_evil_shadow() RETURNS integer
            LANGUAGE sql AS $body$ SELECT 1 $body$;
        RAISE EXCEPTION 'G2: vc_api CREATE FUNCTION in public must be denied';
    EXCEPTION WHEN OTHERS THEN
        IF position('permission' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'G2: unexpected error denying vc_api CREATE in public: %', SQLERRM;
        END IF;
    END;
END $$;
RESET ROLE;

-- ============================================================================
-- G3: a public same-name FUNCTION shadow cannot hijack SECURITY DEFINER resolution.
-- With search_path = vc, pg_catalog an unqualified call inside an SD body resolves
-- vc first, then pg_catalog; public is never searched.
-- ============================================================================
RESET ROLE;  -- superuser plants the shadow

DROP FUNCTION IF EXISTS public.current_owner_id();
CREATE FUNCTION public.current_owner_id() RETURNS bigint
    LANGUAGE sql AS $$ SELECT 999999::bigint $$;

-- A throwaway SECURITY DEFINER probe in vc with the V18-hardened search_path that
-- calls current_owner_id() UNQUALIFIEDly. Ephemeral test object (container is --rm).
CREATE OR REPLACE FUNCTION vc.__rls_probe_unqual_owner() RETURNS bigint
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$ SELECT current_owner_id() $$;

-- TASK-0191: the V27 binding is transaction-local, so the trusted owner
-- context for owner 1 (so vc.current_owner_id() returns 1) is established
-- with a fixture-minted proof INSIDE one transaction that also runs the G3
-- assertions. The G3 objective (unqualified resolution pinned to vc, public
-- shadow never consulted) is unchanged.
BEGIN;
SELECT vc.set_owner_context(1, 'g3x', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'g3x', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));

DO $$
DECLARE
    via_probe    bigint;
    via_qualified bigint;
BEGIN
    via_probe     := vc.__rls_probe_unqual_owner();   -- unqualified call inside SD body
    via_qualified := vc.current_owner_id();           -- qualified direct call to the real vc function
    IF via_probe = 999999 THEN
        RAISE EXCEPTION 'G3: unqualified current_owner_id() inside vc,pg_catalog SD body was hijacked by public shadow (got %)', via_probe;
    END IF;
    IF via_probe IS DISTINCT FROM via_qualified THEN
        RAISE EXCEPTION 'G3: unqualified SD call (%) differs from qualified vc.current_owner_id() (%) — resolution not pinned to vc', via_probe, via_qualified;
    END IF;
    IF via_qualified IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'G3: vc.current_owner_id() returned unexpected value % (expected 1)', via_qualified;
    END IF;
END $$;
COMMIT;

-- Cleanup throwaway probe objects so the migrated schema is left pristine.
DROP FUNCTION IF EXISTS vc.__rls_probe_unqual_owner();
DROP FUNCTION IF EXISTS public.current_owner_id();
RESET ROLE;
