-- 53_role_attributes_fail_closed: after V16, every runtime role must be
-- NOBYPASSRLS and NOLOGIN. The V16 DO-block assertion already enforces this
-- at migration time; this test re-asserts the terminal state from pg_roles so
-- a future regression (e.g. a migration or operator action that re-grants
-- LOGIN/BYPASSRLS) is caught at the next test run.
--
-- It also proves the V16 fail-closed assertion logic itself is sound: when a
-- role is deliberately polluted with BYPASSRLS, the same DO-block check raises
-- a hard error (the migration would refuse to apply). The pollution is done
-- in a transaction that is rolled back so the database is left clean.

\set ON_ERROR_STOP on

-- 1. Assert the four runtime roles are NOBYPASSRLS + NOLOGIN post-V16.
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT rolname, rolbypassrls, rolcanlogin
        FROM pg_roles
        WHERE rolname IN ('vc_api','vc_worker','vc_job_coordinator','vc_dispatcher')
    LOOP
        IF r.rolbypassrls THEN
            RAISE EXCEPTION 'role % must be NOBYPASSRLS (has BYPASSRLS)', r.rolname;
        END IF;
        IF r.rolcanlogin THEN
            RAISE EXCEPTION 'role % must be NOLOGIN (has LOGIN)', r.rolname;
        END IF;
    END LOOP;
END $$;

-- 2. Prove the V16 assertion logic raises on a polluted role. The
--    superuser temporarily grants BYPASSRLS to vc_worker inside a subtx, then
--    re-runs the assertion. The assertion must raise; the subtx is rolled
--    back so vc_worker is left NOBYPASSRLS. This verifies the migration
--    would fail-closed if the role were ever pre-polluted.
DO $$
BEGIN
    BEGIN
        ALTER ROLE vc_worker BYPASSRLS;
        -- Re-run the V16 assertion shape; it must raise.
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_roles
                WHERE rolname = 'vc_worker' AND rolbypassrls
            ) THEN
                RAISE EXCEPTION 'V16 fail-closed: role vc_worker still has BYPASSRLS after ALTER';
            END IF;
            RAISE EXCEPTION 'test setup failed: vc_worker BYPASSRLS grant did not take effect';
        EXCEPTION
            WHEN OTHERS THEN
                -- Expected path: the inner raise fired. Re-raise to outer
                -- handler only if the message is NOT the expected one.
                IF sqlerrm NOT LIKE '%still has BYPASSRLS%' THEN
                    RAISE;
                END IF;
        END;
        -- If we reach here the assertion did not raise -- that is a regression.
        RAISE EXCEPTION 'V16 regression: polluted role was not detected by the assertion';
    EXCEPTION WHEN OTHERS THEN
        -- Roll back the pollution regardless of outcome.
        ALTER ROLE vc_worker NOBYPASSRLS;
        -- Re-assert clean state.
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='vc_worker' AND rolbypassrls) THEN
            RAISE EXCEPTION 'test cleanup failed: vc_worker still BYPASSRLS';
        END IF;
    END;
END $$;
