-- 95_entitlement_snapshot: ENT-SNAP V40 — simulated service-class assignment
-- and immutable per-generation entitlement snapshots.
--
-- Covers: assign_service_class is ADMIN-only (non-ADMIN fails closed,
-- unapproved class RAISEs, unknown target RAISEs), the assignment upserts,
-- list_service_class_assignments returns the registry with ECONOMY defaults;
-- mint_entitlement_snapshot is trusted-owner and idempotent per generation
-- (retries resolve the SAME snapshot id and class), copies the assigned class
-- at mint time (a later reassignment never rewrites the frozen snapshot), and
-- defaults unassigned accounts to ECONOMY; a non-vc_api/non-vc_worker role
-- cannot execute the functions.

\set ON_ERROR_STOP on

TRUNCATE vc.entitlement_snapshot, vc.service_class_assignment,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account CASCADE;

-- Seed accounts: admin (1), user (2).
DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
BEGIN
    SELECT vc.identity_admin_seed('ent-admin', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'ent-user', '$2a$10$user.hash.placeholder', 'USER', 'User') INTO v_user;
END $$;

-- ===========================================================================
-- 1. Assignment: ADMIN-only, upsert, registry with defaults.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
    v_class text;
    v_rows  int;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'ent-admin';
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'ent-user';

    -- Unassigned accounts show ECONOMY in the registry.
    SELECT out_service_class INTO v_class
      FROM vc.list_service_class_assignments(v_admin)
     WHERE out_account_id = v_user;
    IF v_class IS DISTINCT FROM 'ECONOMY' THEN
        RAISE EXCEPTION 'unassigned account must default to ECONOMY (got %)', v_class;
    END IF;

    -- Assign PREMIUM (upsert) and re-read.
    IF vc.assign_service_class(v_admin, v_user, 'PREMIUM') IS NOT TRUE THEN
        RAISE EXCEPTION 'assign_service_class must succeed for an ADMIN';
    END IF;
    SELECT out_service_class INTO v_class
      FROM vc.list_service_class_assignments(v_admin)
     WHERE out_account_id = v_user;
    IF v_class IS DISTINCT FROM 'PREMIUM' THEN
        RAISE EXCEPTION 'assignment must read back PREMIUM (got %)', v_class;
    END IF;

    -- Non-ADMIN caller fails closed.
    BEGIN
        PERFORM vc.assign_service_class(v_user, v_user, 'ECONOMY');
        RAISE EXCEPTION 'non-ADMIN unexpectedly assigned a service class';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;

    -- Unapproved class RAISEs even for an ADMIN.
    BEGIN
        PERFORM vc.assign_service_class(v_admin, v_user, 'PLATINUM');
        RAISE EXCEPTION 'unapproved class unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;

    -- Unknown target RAISEs (existence not disclosed).
    BEGIN
        PERFORM vc.assign_service_class(v_admin, 999999, 'ECONOMY');
        RAISE EXCEPTION 'unknown target unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
END $$;

-- ===========================================================================
-- 2. Snapshot minting: trusted-owner, idempotent per generation, frozen.
--    (Superuser block in the test-92 pattern: superuser bypasses the EXECUTE
--    grants; the trusted-owner context is bound explicitly to the REAL account
--    id read from identity_account.)
-- ===========================================================================
DO $$
DECLARE
    v_user bigint;
    v_gen  bigint;
    v_id1  bigint;
    v_id2  bigint;
    v_cls  text;
BEGIN
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'ent-user';
    IF v_user IS NULL THEN
        RAISE EXCEPTION 'ent-user account missing';
    END IF;

    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_user, 10, 'persona-a', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_user, 100, 10, 'ent-conv');
    PERFORM vc.set_owner_context(v_user, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_user || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));

    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_user, 100, 'ent-key-1', 'user', 'hello');

    -- First mint copies the assigned PREMIUM class.
    SELECT out_id, out_service_class INTO v_id1, v_cls
      FROM vc.mint_entitlement_snapshot(v_user, v_gen);
    IF v_cls IS DISTINCT FROM 'PREMIUM' THEN
        RAISE EXCEPTION 'mint must copy the assigned PREMIUM (got %)', v_cls;
    END IF;

    -- Retry of the same generation resolves the SAME snapshot (FR-ENT-004).
    SELECT out_id, out_service_class INTO v_id2, v_cls
      FROM vc.mint_entitlement_snapshot(v_user, v_gen);
    IF v_id2 IS DISTINCT FROM v_id1 THEN
        RAISE EXCEPTION 'retry must resolve the same snapshot (% vs %)', v_id1, v_id2;
    END IF;

    -- A different generation mints a fresh snapshot row.
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_user, 100, 'ent-key-2', 'user', 'again');
    SELECT out_id INTO v_id2 FROM vc.mint_entitlement_snapshot(v_user, v_gen);
    IF v_id2 = v_id1 THEN
        RAISE EXCEPTION 'a new generation must mint a new snapshot';
    END IF;
END $$;

-- Reassign to ECONOMY: the already-minted snapshot keeps PREMIUM (frozen).
DO $$
DECLARE
    v_admin bigint;
    v_user  bigint;
    v_gen   bigint;
    v_cls   text;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'ent-admin';
    SELECT id INTO v_user FROM vc.identity_account WHERE username = 'ent-user';
    PERFORM vc.assign_service_class(v_admin, v_user, 'ECONOMY');
    SELECT g.id INTO v_gen FROM vc.generation g
     WHERE g.owner_user_id = v_user AND g.idempotency_key = 'ent-key-1';
    SELECT service_class INTO v_cls FROM vc.entitlement_snapshot
     WHERE owner_user_id = v_user AND generation_id = v_gen;
    IF v_cls IS DISTINCT FROM 'PREMIUM' THEN
        RAISE EXCEPTION 'minted snapshot must stay frozen (got %)', v_cls;
    END IF;
END $$;

-- A non-vc_api/non-vc_worker role cannot mint.
SET ROLE vc_dispatcher;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.mint_entitlement_snapshot(2, 1);
    RAISE EXCEPTION 'vc_dispatcher unexpectedly executed mint_entitlement_snapshot';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api, vc_worker
END $$;
COMMIT;
RESET ROLE;
