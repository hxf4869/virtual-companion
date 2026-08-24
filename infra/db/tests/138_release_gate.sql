-- 138_release_gate: S0-24-A V87/V95 — shipped stage is SYNTHETIC;
-- CANARY binds one ACTIVE USER in the same DB row; invalid owners and invalid
-- eval combinations fail closed; runtime roles cannot advance the gate.
-- Stage advancement belongs to the operator/migrator session, so the
-- eval-gate semantics are exercised from the migration-owner role here.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_stage text;
    v_eval boolean;
    v_owner bigint;
BEGIN
    SELECT out_stage, out_eval_passed, out_canary_owner_user_id
      INTO v_stage, v_eval, v_owner
      FROM vc.release_gate_snapshot();
    IF v_stage IS DISTINCT FROM 'SYNTHETIC'
            OR v_eval IS NOT FALSE
            OR v_owner IS NOT NULL THEN
        RAISE EXCEPTION 'shipped gate must be SYNTHETIC without eval or owner, got % % %',
            v_stage, v_eval, v_owner;
    END IF;

    -- V93: a runtime role cannot advance the gate at all (no self-granted
    -- BETA), so even the eval message is unreachable from vc_api.
    BEGIN
        PERFORM vc.advance_release_gate('CANARY', true, 'canary-v1', NULL);
        RAISE EXCEPTION 'vc_api must not be able to advance the release gate';
    EXCEPTION
        WHEN insufficient_privilege THEN NULL;
    END;

    BEGIN
        INSERT INTO vc.release_gate(id, stage, policy_version, eval_passed)
        VALUES (2, 'BETA', 'x', true);
        RAISE EXCEPTION 'direct INSERT on release_gate must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

-- Operator/migrator path: eval semantics of the stage machine.
DO $$
DECLARE
    v_stage text;
    v_eval boolean;
    v_owner bigint;
    v_active_user bigint := nextval('vc.identity_account_id_seq');
    v_admin bigint := nextval('vc.identity_account_id_seq');
    v_disabled_user bigint := nextval('vc.identity_account_id_seq');
BEGIN
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_active_user, 'Release Gate Canary'),
           (v_admin, 'Release Gate Admin'),
           (v_disabled_user, 'Release Gate Disabled');
    INSERT INTO vc.identity_account(
        id, username, password_hash, role, status, display_name
    )
    VALUES
        (v_active_user, 'release-gate-canary-' || v_active_user,
         '$2a$10$release.gate.canary.placeholder', 'USER', 'ACTIVE', 'Release Gate Canary'),
        (v_admin, 'release-gate-admin-' || v_admin,
         '$2a$10$release.gate.admin.placeholder', 'ADMIN', 'ACTIVE', 'Release Gate Admin'),
        (v_disabled_user, 'release-gate-disabled-' || v_disabled_user,
         '$2a$10$release.gate.disabled.placeholder', 'USER', 'DISABLED', 'Release Gate Disabled');

    BEGIN
        UPDATE vc.release_gate
           SET stage = 'CANARY',
               eval_passed = true,
               canary_owner_user_id = NULL
         WHERE id = 1;
        RAISE EXCEPTION 'release_gate CHECK must reject CANARY without an owner';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    BEGIN
        PERFORM vc.advance_release_gate(
            'CANARY', false, 'canary-without-eval-v1', v_active_user
        );
        RAISE EXCEPTION 'CANARY without eval_passed=true must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%require eval_passed=true%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        PERFORM vc.advance_release_gate('CANARY', true, 'canary-no-owner-v1');
        RAISE EXCEPTION 'CANARY without an owner must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%ACTIVE USER%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        PERFORM vc.advance_release_gate('CANARY', true, 'canary-admin-v1', v_admin);
        RAISE EXCEPTION 'CANARY with an ADMIN owner must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%ACTIVE USER%' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        PERFORM vc.advance_release_gate(
            'CANARY', true, 'canary-disabled-v1', v_disabled_user
        );
        RAISE EXCEPTION 'CANARY with a disabled USER owner must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%ACTIVE USER%' THEN
                RAISE;
            END IF;
    END;

    PERFORM vc.advance_release_gate('CANARY', true, 'canary-eval-v1', v_active_user);
    SELECT out_stage, out_eval_passed, out_canary_owner_user_id
      INTO v_stage, v_eval, v_owner
      FROM vc.release_gate_snapshot();
    IF v_stage IS DISTINCT FROM 'CANARY'
            OR v_eval IS DISTINCT FROM TRUE
            OR v_owner IS DISTINCT FROM v_active_user THEN
        RAISE EXCEPTION 'gate must be CANARY with eval and its ACTIVE USER, got % % %',
            v_stage, v_eval, v_owner;
    END if;

    -- Leaving CANARY clears the owner in the same atomic row update.
    PERFORM vc.advance_release_gate('BETA', true, 'beta-eval-v1');
    SELECT out_stage, out_eval_passed, out_canary_owner_user_id
      INTO v_stage, v_eval, v_owner
      FROM vc.release_gate_snapshot();
    IF v_stage IS DISTINCT FROM 'BETA'
            OR v_eval IS DISTINCT FROM TRUE
            OR v_owner IS NOT NULL THEN
        RAISE EXCEPTION 'gate must be BETA with eval and no canary owner, got % % %',
            v_stage, v_eval, v_owner;
    END IF;

    -- Restore the shipped state for later tests.
    PERFORM vc.advance_release_gate('SYNTHETIC', false, 'synthetic-v1');
    SELECT out_stage, out_eval_passed, out_canary_owner_user_id
      INTO v_stage, v_eval, v_owner
      FROM vc.release_gate_snapshot();
    IF v_stage IS DISTINCT FROM 'SYNTHETIC'
            OR v_eval IS NOT FALSE
            OR v_owner IS NOT NULL THEN
        RAISE EXCEPTION 'gate must restore SYNTHETIC without eval or owner, got % % %',
            v_stage, v_eval, v_owner;
    END IF;
END $$;
