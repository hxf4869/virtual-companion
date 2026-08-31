-- 00_owner_binding_secret_seed: TASK-0191 test-harness bootstrap fixture.
--
-- The V27 owner-binding key is provisioned at application startup by
-- OwnerBindingSecretBootstrap (migrator principal, bound database connection parameters) --
-- never expanded into versioned migration SQL. The ephemeral test container
-- has no application process, so this superuser fixture seeds a FIXED
-- test-only key (>= 32 bytes) before the first numbered test runs. The
-- container is anonymous and --rm; this value guards no real deployment.
--
-- Idempotent: re-seeding keeps the existing key (matching the bootstrap's
-- ON CONFLICT DO NOTHING + verify contract).

\set ON_ERROR_STOP on

INSERT INTO vc._owner_binding_secret(id, secret)
VALUES (1, 'vc-test-owner-binding-secret-0123456789abcdef')
ON CONFLICT (id) DO NOTHING;

-- Fail closed if the row is missing or too short to be a valid key.
DO $$
DECLARE
    v_secret text;
BEGIN
    SELECT secret INTO v_secret FROM vc._owner_binding_secret WHERE id = 1;
    IF v_secret IS NULL OR length(v_secret) < 32 THEN
        RAISE EXCEPTION 'test fixture: owner binding secret missing or too short';
    END IF;
END $$;
