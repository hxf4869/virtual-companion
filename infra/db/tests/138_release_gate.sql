-- 138_release_gate: S0-24-A V87 (+V93 review-fix) — shipped stage is
-- SYNTHETIC; CANARY/BETA without eval_passed fail closed; runtime roles
-- hold no table DML and (V93) cannot execute advance_release_gate at all.
-- Stage advancement belongs to the operator/migrator session, so the
-- eval-gate semantics are exercised from the migration-owner role here.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_stage text;
    v_eval boolean;
BEGIN
    SELECT out_stage, out_eval_passed INTO v_stage, v_eval
      FROM vc.release_gate_snapshot();
    IF v_stage IS DISTINCT FROM 'SYNTHETIC' OR v_eval IS NOT FALSE THEN
        RAISE EXCEPTION 'shipped gate must be SYNTHETIC without eval, got % %', v_stage, v_eval;
    END IF;

    -- V93: a runtime role cannot advance the gate at all (no self-granted
    -- BETA), so even the eval message is unreachable from vc_api.
    BEGIN
        PERFORM vc.advance_release_gate('CANARY', false, 'canary-v1');
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
BEGIN
    BEGIN
        PERFORM vc.advance_release_gate('CANARY', false, 'canary-v1');
        RAISE EXCEPTION 'CANARY without eval_passed must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%require eval_passed%' THEN
                RAISE;
            END IF;
    END;

    PERFORM vc.advance_release_gate('CANARY', true, 'canary-eval-v1');
    SELECT out_stage, out_eval_passed INTO v_stage, v_eval
      FROM vc.release_gate_snapshot();
    IF v_stage IS DISTINCT FROM 'CANARY' OR v_eval IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'gate must be CANARY with eval after operator advance, got % %',
            v_stage, v_eval;
    END if;
END $$;
