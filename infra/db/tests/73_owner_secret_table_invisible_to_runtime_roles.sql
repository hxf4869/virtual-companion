-- 73_owner_secret_table_invisible_to_runtime_roles: TASK-0191 -- the HMAC
-- key table vc._owner_binding_secret has zero privileges for PUBLIC and for
-- every runtime role, so a session holding runtime-role credentials cannot
-- read the key and therefore cannot mint proofs. Privilege-catalog
-- assertions plus a live denial probe under the REAL runtime role.

\set ON_ERROR_STOP on

DO $$
DECLARE
    role text;
BEGIN
    FOREACH role IN ARRAY ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher']
    LOOP
        IF has_table_privilege(role, 'vc._owner_binding_secret', 'SELECT') THEN
            RAISE EXCEPTION '% must not hold SELECT on the owner binding secret', role;
        END IF;
        IF has_table_privilege(role, 'vc._owner_binding_secret', 'INSERT') THEN
            RAISE EXCEPTION '% must not hold INSERT on the owner binding secret', role;
        END IF;
        IF has_table_privilege(role, 'vc._owner_binding_secret', 'UPDATE') THEN
            RAISE EXCEPTION '% must not hold UPDATE on the owner binding secret', role;
        END IF;
        IF has_table_privilege(role, 'vc._owner_binding_secret', 'DELETE') THEN
            RAISE EXCEPTION '% must not hold DELETE on the owner binding secret', role;
        END IF;
    END LOOP;
    IF has_table_privilege('public', 'vc._owner_binding_secret', 'SELECT') THEN
        RAISE EXCEPTION 'PUBLIC must not hold SELECT on the owner binding secret';
    END IF;
END $$;

-- Live denial probes: each runtime role's direct read must fail with
-- permission denied (SQLSTATE 42501), proving the catalog state holds at
-- runtime, not just in catalogs. Includes the proof-minting oracle helpers:
-- without EXECUTE a runtime session cannot ask the database to compute a
-- valid proof for an arbitrary tuple.
DO $$
DECLARE
    role text;
BEGIN
    FOREACH role IN ARRAY ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher']
    LOOP
        EXECUTE format('SET ROLE %I', role);
        BEGIN
            EXECUTE 'SELECT count(*) FROM vc._owner_binding_secret';
            RAISE EXCEPTION '% must not be able to read the owner binding secret', role;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;  -- expected
        END;
        BEGIN
            EXECUTE 'SELECT vc._owner_binding_expected(1, ''x'')';
            RAISE EXCEPTION '% must not be able to mint owner binding proofs', role;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;  -- expected
        END;
        BEGIN
            EXECUTE 'SELECT vc._owner_binding_message(1, ''x'')';
            RAISE EXCEPTION '% must not be able to read the binding message oracle', role;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;  -- expected
        END;
    END LOOP;
END $$;
RESET ROLE;

-- Catalog cross-check for the helpers (defense in depth with the probes).
DO $$
DECLARE
    role text;
BEGIN
    FOREACH role IN ARRAY ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher']
    LOOP
        IF has_function_privilege(role, 'vc._owner_binding_expected(bigint, text)', 'EXECUTE') THEN
            RAISE EXCEPTION '% must not hold EXECUTE on the proof-minting helper', role;
        END IF;
        IF has_function_privilege(role, 'vc._owner_binding_message(bigint, text)', 'EXECUTE') THEN
            RAISE EXCEPTION '% must not hold EXECUTE on the binding message helper', role;
        END IF;
    END LOOP;
    IF has_function_privilege('public', 'vc._owner_binding_expected(bigint, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC must not hold EXECUTE on the proof-minting helper';
    END IF;
END $$;
