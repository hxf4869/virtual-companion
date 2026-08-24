-- 146_provider_durable_rollback: S0-24-C durable provider rollback is
-- function-only, idempotent, fail-closed, and records sanitized fixed-code
-- history for both changed and already-disabled calls.

\set ON_ERROR_STOP on

DELETE FROM vc.provider_rollback_history
 WHERE provider_id IN ('rollback-provider-a', 'rollback-provider-missing');
DELETE FROM vc.provider_deployment
 WHERE provider_id IN ('rollback-provider-a', 'rollback-provider-missing');
INSERT INTO vc.provider_deployment(
        provider_id, protocol, capabilities, admission_state)
VALUES ('rollback-provider-a', 'OPENAI_COMPATIBLE', ARRAY['TEXT'], 'ADMITTED');

-- The automatic worker path transitions ADMITTED -> DISABLED.
BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_history_id bigint;
    v_previous text;
    v_changed boolean;
    v_at timestamptz;
BEGIN
    SELECT out_history_id, out_previous_admission_state,
           out_changed, out_rolled_back_at
      INTO v_history_id, v_previous, v_changed, v_at
      FROM vc.rollback_provider_deployment(
          'rollback-provider-a', 'CONSECUTIVE_FAILURES', 'AUTO');
    IF v_history_id IS NULL OR v_previous IS DISTINCT FROM 'ADMITTED'
       OR NOT v_changed OR v_at IS NULL THEN
        RAISE EXCEPTION 'first rollback returned an invalid result';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_state text;
    v_count integer;
BEGIN
    SELECT admission_state INTO v_state
      FROM vc.provider_deployment
     WHERE provider_id = 'rollback-provider-a';
    IF v_state IS DISTINCT FROM 'DISABLED' THEN
        RAISE EXCEPTION 'rollback must durably set DISABLED, got %', v_state;
    END IF;

    SELECT count(*) INTO v_count
      FROM vc.provider_rollback_history
     WHERE provider_id = 'rollback-provider-a'
       AND trigger_code = 'CONSECUTIVE_FAILURES'
       AND actor_code = 'AUTO'
       AND previous_admission_state = 'ADMITTED'
       AND changed
       AND rolled_back_at IS NOT NULL;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'first rollback must append one changed history row, got %', v_count;
    END IF;
END $$;

-- Repeating the rollback is safe and explains already-disabled via history.
BEGIN;
SET LOCAL ROLE vc_job_coordinator;
DO $$
DECLARE
    v_previous text;
    v_changed boolean;
BEGIN
    SELECT out_previous_admission_state, out_changed
      INTO v_previous, v_changed
      FROM vc.rollback_provider_deployment(
          'rollback-provider-a', 'OPERATOR', 'OPERATOR');
    IF v_previous IS DISTINCT FROM 'DISABLED' OR v_changed THEN
        RAISE EXCEPTION 'repeat rollback must report DISABLED/false';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
      FROM vc.provider_rollback_history
     WHERE provider_id = 'rollback-provider-a';
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'two rollback calls must produce two history rows, got %', v_count;
    END IF;

    SELECT count(*) INTO v_count
      FROM vc.provider_rollback_history
     WHERE provider_id = 'rollback-provider-a'
       AND trigger_code = 'OPERATOR'
       AND actor_code = 'OPERATOR'
       AND previous_admission_state = 'DISABLED'
       AND NOT changed
       AND rolled_back_at IS NOT NULL;
    IF v_count <> 1 THEN
        RAISE EXCEPTION 'repeat rollback history must explain already-disabled';
    END IF;
END $$;

-- Fixed-code validation and an absent provider both fail closed without history.
BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        PERFORM * FROM vc.rollback_provider_deployment(
            'rollback-provider-a', 'FREE_FORM_REASON', 'AUTO');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%unsupported trigger code%' THEN
            v_denied := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'free-form rollback trigger must fail closed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.rollback_provider_deployment(
            'rollback-provider-a', 'SAFETY_LEAK', 'SYSTEM');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%unsupported actor code%' THEN
            v_denied := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'free-form rollback actor must fail closed';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.rollback_provider_deployment(
            'rollback-provider-a', 'SAFETY_LEAK', 'AUTO');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%trigger/actor combination is not allowed%' THEN
            v_denied := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'safety leak rollback must require an operator actor';
    END IF;

    v_denied := false;
    BEGIN
        PERFORM * FROM vc.rollback_provider_deployment(
            'rollback-provider-missing', 'BILLING_DRIFT', 'AUTO');
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%provider unavailable%' THEN
            v_denied := true;
        ELSE
            RAISE;
        END IF;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'missing provider must fail closed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count
      FROM vc.provider_rollback_history
     WHERE provider_id IN ('rollback-provider-a', 'rollback-provider-missing');
    IF v_count <> 2 THEN
        RAISE EXCEPTION 'failed rollback calls must not append history, got %', v_count;
    END IF;
END $$;

-- PUBLIC/vc_api cannot execute; only the two automatic-operation roles can.
DO $$
BEGIN
    IF has_function_privilege(
            'public', 'vc.rollback_provider_deployment(text, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC must not execute rollback_provider_deployment';
    END IF;
    IF has_function_privilege(
            'vc_api', 'vc.rollback_provider_deployment(text, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_api must not execute rollback_provider_deployment';
    END IF;
    IF has_function_privilege(
            'vc_dispatcher', 'vc.rollback_provider_deployment(text, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_dispatcher must not execute rollback_provider_deployment';
    END IF;
    IF NOT has_function_privilege(
            'vc_worker', 'vc.rollback_provider_deployment(text, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_worker must execute rollback_provider_deployment';
    END IF;
    IF NOT has_function_privilege(
            'vc_job_coordinator',
            'vc.rollback_provider_deployment(text, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'vc_job_coordinator must execute rollback_provider_deployment';
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        PERFORM * FROM vc.rollback_provider_deployment(
            'rollback-provider-a', 'OPERATOR', 'OPERATOR');
    EXCEPTION
        WHEN insufficient_privilege THEN
            v_denied := true;
        WHEN others THEN
            IF SQLERRM LIKE '%permission denied%' THEN
                v_denied := true;
            ELSE
                RAISE;
            END IF;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_api unexpectedly executed provider rollback';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Runtime roles retain provider reads but cannot bypass the function with UPDATE.
BEGIN;
SET LOCAL ROLE vc_job_coordinator;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        UPDATE vc.provider_deployment
           SET admission_state = 'ADMITTED'
         WHERE provider_id = 'rollback-provider-a';
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_job_coordinator must not directly UPDATE provider_deployment';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_denied boolean := false;
BEGIN
    BEGIN
        UPDATE vc.provider_deployment
           SET admission_state = 'ADMITTED'
         WHERE provider_id = 'rollback-provider-a';
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'vc_worker must not directly UPDATE provider_deployment';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The history relation itself stays restricted and has no payload/secret fields.
DO $$
DECLARE
    v_privileges integer;
    v_forbidden_columns integer;
BEGIN
    SELECT count(*) INTO v_privileges
      FROM information_schema.role_table_grants
     WHERE table_schema = 'vc'
       AND table_name = 'provider_rollback_history'
       AND grantee IN (
           'PUBLIC', 'vc_api', 'vc_worker', 'vc_job_coordinator', 'vc_dispatcher');
    IF v_privileges <> 0 THEN
        RAISE EXCEPTION 'runtime/PUBLIC must have no direct history privileges, got %',
            v_privileges;
    END IF;

    SELECT count(*) INTO v_forbidden_columns
      FROM information_schema.columns
     WHERE table_schema = 'vc'
       AND table_name = 'provider_rollback_history'
       AND lower(column_name) ~ '(endpoint|credential|account|body|content|message|token|secret)';
    IF v_forbidden_columns <> 0 THEN
        RAISE EXCEPTION 'rollback history contains forbidden payload/secret columns';
    END IF;
END $$;
