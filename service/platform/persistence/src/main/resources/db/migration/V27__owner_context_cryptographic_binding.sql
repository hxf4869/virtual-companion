-- TASK-0191 V27: cryptographic owner-context binding (P0-01 remediation).
--
-- Root cause: the tenant-isolation trust root was the session-writable custom
-- GUC vc.owner_user_id. PostgreSQL cannot revoke SET/set_config on a custom
-- GUC namespace, so any session (runtime role credentials, SQL injection, or
-- vc.begin_job_context with its default PUBLIC EXECUTE) could forge an
-- arbitrary owner and FORCE RLS would happily treat it as the tenant.
--
-- V27 replaces that trust root with a domain-separated HMAC proof binding:
--
--   proof = HMAC-SHA256(K, 'vc-owner-binding-v1|' || owner || '|' ||
--                               pg_backend_pid() || '|' ||
--                               pg_current_xact_id() || '|' || nonce)
--
-- * K lives ONLY in vc._owner_binding_secret (zero privileges for PUBLIC and
--   every runtime role) and in the application process environment
--   (VC_OWNER_BINDING_SECRET, >= 32 random bytes, never derived from the DB
--   password). This migration contains NO key material: the restricted table
--   is initialized idempotently by the migrator startup phase via bound JDBC
--   parameters (OwnerBindingSecretBootstrap), before business traffic and
--   readiness.
-- * The proof binds owner + backend/session identity + transaction identity +
--   a fresh nonce, so it cannot be replayed across owners, transactions or
--   connections, and cannot be recomputed by a session that cannot read K.
-- * vc.current_owner_id() re-validates the full tuple on every call and
--   returns NULL (fail closed) when any GUC, the secret or the HMAC check is
--   missing or mismatched. Every RLS policy and every V17 owner assertion
--   reads the owner through this function, so they harden with zero changes.
-- * All three context GUCs (vc.owner_user_id, vc.owner_nonce,
--   vc.owner_binding) are transaction-local only (set_config(..., true)).
-- * vc.begin_job_context loses EXECUTE for PUBLIC and all runtime roles
--   (Owner decision 2026-08-13: no ordinary-runtime-callable arbitrary-owner
--   entry may remain). The function is neither redefined nor dropped; its
--   migrator-owned definition from V1 stays frozen.
--
-- Append-only: V1-V26 are untouched (Flyway checksum safe). No RLS policy,
-- table-structure or V17 function changes.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. Restricted secret table. Owner: the migration principal. No grants to
--    PUBLIC (tables have none by default) and none to any runtime role: the
--    roles below cannot SELECT, UPDATE or DELETE the key. Zero-privilege is
--    asserted fail-closed at the end of this migration.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc._owner_binding_secret (
    id     integer PRIMARY KEY,
    secret text NOT NULL
);

REVOKE ALL ON TABLE vc._owner_binding_secret FROM PUBLIC;
REVOKE ALL ON TABLE vc._owner_binding_secret
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- 2. Internal proof helpers (not granted to anyone; callable only from other
--    SECURITY DEFINER bodies in this schema, which bypass EXECUTE checks for
--    internal calls).
-- ---------------------------------------------------------------------------

-- Canonical domain-separated message for one (owner, session, transaction,
-- nonce) tuple. The domain tag is fixed here so callers can never substitute
-- their own framing.
CREATE OR REPLACE FUNCTION vc._owner_binding_message(
    p_owner bigint,
    p_nonce text
)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT 'vc-owner-binding-v1|' || p_owner::text || '|' ||
           pg_backend_pid()::text || '|' ||
           pg_current_xact_id()::text || '|' || p_nonce
$$;

-- Expected proof for one tuple, computed with the stored key. SECURITY
-- DEFINER lets it read the restricted table, and it is deliberately granted
-- to NO role: with PostgreSQL's default PUBLIC EXECUTE it would become a
-- proof-minting oracle for any runtime session, so EXECUTE is revoked from
-- PUBLIC and from every runtime role (asserted fail-closed below). Only the
-- function owner (migrator principal) and internal SECURITY DEFINER calls
-- (set_owner_context / current_owner_id) can reach it.
CREATE OR REPLACE FUNCTION vc._owner_binding_expected(
    p_owner bigint,
    p_nonce text
)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT encode(
        hmac(
            convert_to(vc._owner_binding_message(p_owner, p_nonce), 'UTF8'),
            convert_to((SELECT s.secret FROM vc._owner_binding_secret s WHERE s.id = 1), 'UTF8'),
            'sha256'
        ),
        'hex'
    )
$$;

REVOKE EXECUTE ON FUNCTION vc._owner_binding_expected(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc._owner_binding_expected(bigint, text)
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE EXECUTE ON FUNCTION vc._owner_binding_message(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc._owner_binding_message(bigint, text)
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- 3. Trusted establisher. Granted to the runtime roles (the application must
--    be able to establish the context for the server-authenticated owner),
--    but a caller cannot forge a proof for an arbitrary owner without K, and
--    the proof dies with the transaction/session it was minted for.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.set_owner_context(
    p_owner bigint,
    p_nonce text,
    p_proof text
)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_expected text;
    v_key_missing boolean;
BEGIN
    IF p_owner IS NULL OR p_owner <= 0 THEN
        RAISE EXCEPTION 'set_owner_context: owner_user_id must be positive';
    END IF;
    IF p_nonce IS NULL OR length(btrim(p_nonce)) = 0
       OR length(p_nonce) > 256 THEN
        RAISE EXCEPTION 'set_owner_context: invalid nonce';
    END IF;
    IF p_proof IS NULL OR length(p_proof) <> 64 THEN
        RAISE EXCEPTION 'set_owner_context: invalid proof';
    END IF;

    SELECT NOT EXISTS (
        SELECT 1 FROM vc._owner_binding_secret s WHERE s.id = 1
    ) INTO v_key_missing;
    IF v_key_missing THEN
        RAISE EXCEPTION 'set_owner_context: binding secret is not initialized';
    END IF;

    v_expected := vc._owner_binding_expected(p_owner, p_nonce);
    IF p_proof <> v_expected THEN
        RAISE EXCEPTION 'set_owner_context: proof rejected';
    END IF;

    PERFORM set_config('vc.owner_user_id', p_owner::text, true);
    PERFORM set_config('vc.owner_nonce', p_nonce, true);
    PERFORM set_config('vc.owner_binding', p_proof, true);
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.set_owner_context(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.set_owner_context(bigint, text, text)
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- 4. Hardened trust root. Same signature and null-on-no-context contract as
--    V1 so every RLS policy and V17 assertion keeps working unchanged, but
--    the raw GUC alone is worthless: the proof must verify against K for
--    exactly this owner, session, transaction and nonce on every call.
--    STABLE is sound: all inputs (transaction-local GUCs, backend pid, xact
--    id) are constant within a statement, and the body recomputes the HMAC
--    each time it is evaluated.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.current_owner_id()
    RETURNS bigint
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner  text;
    v_nonce  text;
    v_proof  text;
    v_expected text;
BEGIN
    v_owner := NULLIF(current_setting('vc.owner_user_id', true), '');
    v_nonce := NULLIF(current_setting('vc.owner_nonce', true), '');
    v_proof := NULLIF(current_setting('vc.owner_binding', true), '');
    IF v_owner IS NULL OR v_nonce IS NULL OR v_proof IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc._owner_binding_secret s WHERE s.id = 1) THEN
        RETURN NULL;
    END IF;
    BEGIN
        v_expected := vc._owner_binding_expected(v_owner::bigint, v_nonce);
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN NULL;
    END;
    IF v_proof <> v_expected THEN
        RETURN NULL;
    END IF;
    RETURN v_owner::bigint;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Close the unauthenticated entry point (Owner decision 2026-08-13).
--    begin_job_context keeps its frozen V1 definition but no runtime role
--    (and no PUBLIC) may execute it: only the function owner / migrator
--    principal retains it. There is deliberately no replacement arbitrary-
--    owner establisher for ordinary runtime sessions.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION vc.begin_job_context(bigint, text)
    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.begin_job_context(bigint, text)
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- 6. Fail-closed postconditions. The migration itself must abort if any
--    privilege edge it depends on did not take effect.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    r record;
    has_exec boolean;
    tbl_priv text;
BEGIN
    -- set_owner_context: exactly the four runtime roles (+ owner), never PUBLIC.
    FOR r IN
        SELECT rolname FROM pg_roles
        WHERE rolname IN ('vc_api','vc_worker','vc_job_coordinator','vc_dispatcher')
    LOOP
        SELECT has_function_privilege(r.rolname,
            'vc.set_owner_context(bigint, text, text)', 'EXECUTE')
            INTO has_exec;
        IF NOT has_exec THEN
            RAISE EXCEPTION 'V27 fail-closed: % lacks set_owner_context EXECUTE', r.rolname;
        END IF;
        SELECT has_function_privilege(r.rolname,
            'vc.begin_job_context(bigint, text)', 'EXECUTE') INTO has_exec;
        IF has_exec THEN
            RAISE EXCEPTION 'V27 fail-closed: % still has begin_job_context EXECUTE', r.rolname;
        END IF;
        IF has_function_privilege(r.rolname,
            'vc._owner_binding_expected(bigint, text)', 'EXECUTE') THEN
            RAISE EXCEPTION 'V27 fail-closed: % can mint owner binding proofs', r.rolname;
        END IF;
        IF has_function_privilege(r.rolname,
            'vc._owner_binding_message(bigint, text)', 'EXECUTE') THEN
            RAISE EXCEPTION 'V27 fail-closed: % can read the binding message oracle', r.rolname;
        END IF;
        IF has_table_privilege(r.rolname, 'vc._owner_binding_secret', 'SELECT') THEN
            RAISE EXCEPTION 'V27 fail-closed: % can read the binding secret table', r.rolname;
        END IF;
    END LOOP;
    IF has_function_privilege('public',
            'vc.set_owner_context(bigint, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V27 fail-closed: PUBLIC has set_owner_context EXECUTE';
    END IF;
    IF has_function_privilege('public',
            'vc.begin_job_context(bigint, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V27 fail-closed: PUBLIC has begin_job_context EXECUTE';
    END IF;
    IF has_function_privilege('public',
            'vc._owner_binding_expected(bigint, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V27 fail-closed: PUBLIC can mint owner binding proofs';
    END IF;
    IF has_function_privilege('public',
            'vc._owner_binding_message(bigint, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V27 fail-closed: PUBLIC can read the binding message oracle';
    END IF;
    SELECT count(*)::text INTO tbl_priv FROM pg_tables
     WHERE schemaname = 'vc' AND tablename = '_owner_binding_secret';
    IF tbl_priv <> '1' THEN
        RAISE EXCEPTION 'V27 fail-closed: binding secret table missing';
    END IF;
END $$;
