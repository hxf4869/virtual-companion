-- 138_release_gate: S0-24-A V87 — shipped stage is SYNTHETIC; CANARY/BETA
-- without eval_passed fail closed; runtime roles have no table DML.

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

    BEGIN
        PERFORM vc.advance_release_gate('CANARY', false, 'canary-v1');
        RAISE EXCEPTION 'CANARY without eval_passed must fail closed';
    EXCEPTION
        WHEN others THEN
            IF SQLERRM NOT LIKE '%require eval_passed%' THEN
                RAISE;
            END IF;
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
