-- 128_runtime_roles_direct_dml_whitelist: S0-27 decision-independent hardening.
-- Test 52 pins the V16-era DML revokes by ENUMERATING 17 tables; every table
-- introduced after V16 (reminders, entitlement_snapshot, consent_record,
-- export_request, emergency_contact, conversation_summary, ...) is outside
-- that enumeration, so one careless future "GRANT INSERT ... TO vc_api" would
-- slip through the whole suite. This test replaces enumeration with a generic
-- catalog sweep over ALL tables and views in schema vc:
--   G1: vc_api / vc_worker / vc_dispatcher hold ZERO direct write grants
--       (INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER) on any object;
--   G2: vc_job_coordinator's write surface is exactly the V4 whitelist
--       {provider_deployment: INSERT, UPDATE} -- no DELETE/TRUNCATE anywhere,
--       no grants on any other table (V16 explicitly excludes only this one);
--   G3: PUBLIC holds zero table privileges in schema vc (runtime roles
--       inherit PUBLIC, so this also bounds what they can pick up implicitly;
--       the secret table's PUBLIC check in test 73 stays table-specific).
--
-- Decision-independent by construction: it constrains only migration-created
-- NOLOGIN roles plus PUBLIC, holding under ANY operator LOGIN-role scheme.
-- A future intentional direct-write path must consciously extend the G2
-- whitelist here -- that failure IS the drift guard working.
--
-- Auto-picked by infra/db/run-rls-tests.sh ([0-9][0-9]*_*.sql glob).

\set ON_ERROR_STOP on

DO $$
DECLARE
    n int;
BEGIN
    -- G1: api/worker/dispatcher must have zero direct write grants anywhere.
    SELECT count(*) INTO n
      FROM information_schema.role_table_grants
     WHERE table_schema = 'vc'
       AND grantee IN ('vc_api','vc_worker','vc_dispatcher')
       AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
    IF n <> 0 THEN
        RAISE EXCEPTION
            'G1: vc_api/vc_worker/vc_dispatcher hold % direct write grant(s) in schema vc (must be zero) -- see information_schema.role_table_grants', n;
    END IF;

    -- G2a: coordinator must never gain row-removal or schema-binding grants.
    SELECT count(*) INTO n
      FROM information_schema.role_table_grants
     WHERE table_schema = 'vc'
       AND grantee = 'vc_job_coordinator'
       AND privilege_type IN ('DELETE','TRUNCATE','REFERENCES','TRIGGER');
    IF n <> 0 THEN
        RAISE EXCEPTION
            'G2a: vc_job_coordinator holds % DELETE/TRUNCATE/REFERENCES/TRIGGER grant(s) in schema vc (must be zero)', n;
    END IF;

    -- G2b: coordinator's INSERT/UPDATE grants are exactly the V4 whitelist.
    SELECT count(*) INTO n
      FROM information_schema.role_table_grants
     WHERE table_schema = 'vc'
       AND grantee = 'vc_job_coordinator'
       AND privilege_type IN ('INSERT','UPDATE')
       AND NOT (table_name = 'provider_deployment'
                AND privilege_type IN ('INSERT','UPDATE'));
    IF n <> 0 THEN
        RAISE EXCEPTION
            'G2b: vc_job_coordinator holds % INSERT/UPDATE grant(s) outside the provider_deployment whitelist', n;
    END IF;

    -- G3: PUBLIC inherits nothing at table level in the tenant schema.
    SELECT count(*) INTO n
      FROM information_schema.role_table_grants
     WHERE table_schema = 'vc'
       AND grantee = 'PUBLIC';
    IF n <> 0 THEN
        RAISE EXCEPTION
            'G3: PUBLIC holds % table privilege(s) in schema vc (must be zero)', n;
    END IF;
END $$;

-- Sanity: the legitimate runtime read path survives unchanged.
DO $$
BEGIN
    IF vc.current_owner_id() IS NOT NULL THEN
        RAISE EXCEPTION 'current_owner_id must stay NULL with no owner context';
    END IF;
END $$;
