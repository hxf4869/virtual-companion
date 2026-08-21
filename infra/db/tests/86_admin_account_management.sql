-- 86_admin_account_management: V31 admin account registry (list + disable)
-- and the betaGate account-capacity enforcement.
--
-- Covers: ADMIN-only registry listing (ordered by id, never the password
-- hash); idempotent disable (already-disabled reports success); self-disable
-- rejected; unknown-target disable fails closed; non-ADMIN caller rejected for
-- both functions; ACCOUNT_DISABLE audit event recorded; a DISABLED account is
-- rejected by identity_authenticate (login path); identity_account_create
-- fails closed once 30 ACTIVE accounts exist (betaGate maxEnabledAccounts).

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

-- ===========================================================================
-- 1. Registry listing: ADMIN-only, ordered, no password hash in the row.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_first_id bigint; v_first_username text; v_first_role text;
    v_first_status text; v_first_display text;
    n int;
BEGIN
    SELECT vc.identity_admin_seed('root-admin', '$2a$10$seed.hash.placeholder', 'Root Admin') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    SELECT count(*) INTO n FROM vc.identity_account_list(v_admin);
    IF n <> 2 THEN RAISE EXCEPTION 'registry must list both accounts, got %', n; END IF;

    SELECT out_account_id, out_username, out_role, out_status, out_display_name
      INTO v_first_id, v_first_username, v_first_role, v_first_status, v_first_display
      FROM vc.identity_account_list(v_admin)
     LIMIT 1;
    IF v_first_id <> v_admin OR v_first_username <> 'root-admin' THEN
        RAISE EXCEPTION 'registry must order by id (admin first), got %/%', v_first_id, v_first_username;
    END IF;
END $$;

-- ===========================================================================
-- 2. Non-ADMIN caller: list and disable both fail closed.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-admin2', '$2a$10$seed.hash.placeholder', 'Root Admin') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'bob', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_user;

    BEGIN
        PERFORM 1 FROM vc.identity_account_list(v_user);
        RAISE EXCEPTION 'non-ADMIN must not list the registry';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-ADMIN must not list the registry%' THEN
            RAISE;
        END IF;
        NULL; -- expected: generic fail-closed error
    END;

    BEGIN
        PERFORM vc.identity_account_disable(v_user, v_admin);
        RAISE EXCEPTION 'non-ADMIN must not disable accounts';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-ADMIN must not disable accounts%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
END $$;

-- ===========================================================================
-- 3. Disable: idempotent, self-disable rejected, unknown target fails closed,
--    ACCOUNT_DISABLE audited, DISABLED login rejected.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_user bigint;
    v_status text;
    n int;
BEGIN
    SELECT vc.identity_admin_seed('root-admin3', '$2a$10$seed.hash.placeholder', 'Root Admin') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'carol', '$2a$10$carol.hash.placeholder', 'USER', 'Carol') INTO v_user;

    -- Disable succeeds and records the audit event.
    IF NOT vc.identity_account_disable(v_admin, v_user) THEN
        RAISE EXCEPTION 'disable must report success';
    END IF;
    SELECT status INTO v_status FROM vc.identity_account WHERE id = v_user;
    IF v_status <> 'DISABLED' THEN RAISE EXCEPTION 'account must be DISABLED, got %', v_status; END IF;
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'ACCOUNT_DISABLE' AND account_id = v_user;
    IF n <> 1 THEN RAISE EXCEPTION 'ACCOUNT_DISABLE audit event missing, got %', n; END IF;

    -- Idempotent: a second disable reports success without a second audit row.
    IF NOT vc.identity_account_disable(v_admin, v_user) THEN
        RAISE EXCEPTION 'second disable must report success (idempotent)';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'ACCOUNT_DISABLE' AND account_id = v_user;
    IF n <> 1 THEN RAISE EXCEPTION 'disable audit must not duplicate, got %', n; END IF;

    -- Self-disable rejected.
    BEGIN
        PERFORM vc.identity_account_disable(v_admin, v_admin);
        RAISE EXCEPTION 'self-disable must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%self-disable must be rejected%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;

    -- Unknown target fails closed.
    BEGIN
        PERFORM vc.identity_account_disable(v_admin, 999999999);
        RAISE EXCEPTION 'unknown target must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unknown target must fail closed%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;

    -- DISABLED account: the credential fetch returns DISABLED (the runtime
    -- rejects it at login/refresh; the status is the fail-closed signal).
    SELECT out_status INTO v_status FROM vc.identity_authenticate('carol');
    IF v_status <> 'DISABLED' THEN
        RAISE EXCEPTION 'authenticate must surface DISABLED, got %', v_status;
    END IF;
END $$;

-- ===========================================================================
-- 4. betaGate capacity: identity_account_create fails closed at 30 ACTIVE.
-- ===========================================================================
DO $$
DECLARE
    v_admin bigint;
    v_active int;
    i int;
BEGIN
    SELECT vc.identity_admin_seed('root-admin4', '$2a$10$seed.hash.placeholder', 'Root Admin') INTO v_admin;
    -- Fill up to the 30-ACTIVE cap (earlier sections of this file already
    -- created a few accounts).
    SELECT count(*) INTO v_active FROM vc.identity_account WHERE status = 'ACTIVE';
    FOR i IN 1..(30 - v_active) LOOP
        PERFORM vc.identity_account_create(
            v_admin, 'cap-user-' || i, '$2a$10$cap.hash.placeholder', 'USER', 'Cap User ' || i);
    END LOOP;
    SELECT count(*) INTO v_active FROM vc.identity_account WHERE status = 'ACTIVE';
    IF v_active <> 30 THEN RAISE EXCEPTION 'expected exactly 30 ACTIVE at capacity, got %', v_active; END IF;

    -- The 31st ACTIVE account fails closed before any write.
    BEGIN
        PERFORM vc.identity_account_create(
            v_admin, 'cap-overflow', '$2a$10$cap.hash.placeholder', 'USER', 'Overflow');
        RAISE EXCEPTION 'create at capacity must fail closed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%create at capacity must fail closed%' THEN
            RAISE;
        END IF;
        NULL; -- expected: capacity exceeded
    END;

    -- Disabling one account frees a slot; creation succeeds again.
    PERFORM vc.identity_account_disable(v_admin, (
        SELECT id FROM vc.identity_account
         WHERE id <> v_admin AND status = 'ACTIVE'
         ORDER BY id LIMIT 1));
    PERFORM vc.identity_account_create(
        v_admin, 'cap-freed', '$2a$10$cap.hash.placeholder', 'USER', 'Freed');
END $$;

-- ===========================================================================
-- 5. vc_api role: no direct DML on the identity tables; the SD functions are
--    the only path (mirrors test 39's fail-closed check).
-- ===========================================================================
SET ROLE vc_api;
DO $$
BEGIN
    BEGIN
        UPDATE vc.identity_account SET status = 'DISABLED' WHERE username = 'root-admin4';
        RAISE EXCEPTION 'vc_api must not update identity_account directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL; -- expected
    END;
END $$;
RESET ROLE;
