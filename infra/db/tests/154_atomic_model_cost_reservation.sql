-- 154_atomic_model_cost_reservation: S0-29 versioned prices, idempotent retry,
-- settle/release, fixed thresholds, unknown-price refusal and concurrent cap.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;
TRUNCATE vc.model_cost_reservation, vc.month_cost_budget, vc.model_unit_price;

DO $$
DECLARE v_admin bigint; v_user bigint;
BEGIN
    SELECT vc.identity_admin_seed(
        'root-model-cost', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'user-model-cost', '$2a$10$user.hash.placeholder',
        'USER', 'User') INTO v_user;
    INSERT INTO vc.model_unit_price(
        provider_id, model_id, price_version, input_usd_per_1k,
        output_usd_per_1k, effective_from, active)
    VALUES ('provider-cost', 'model-cost', 1, 0.10, 0.20, now() - interval '1 day', true),
           ('provider-cost', 'model-cost', 2, 9.99, 9.99, now() + interval '1 day', true);
    PERFORM set_config('t.user', v_user::text, false);
END $$;

BEGIN;
SELECT vc.set_owner_context(
    current_setting('t.user')::bigint,
    'model-cost-main',
    encode(vc.hmac(convert_to('vc-owner-binding-v1|'
        || current_setting('t.user') || '|' || pg_backend_pid() || '|'
        || pg_current_xact_id() || '|model-cost-main', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
    v_reserved numeric;
    v_threshold text;
    v_inserted boolean;
    v_actual numeric;
    v_changed boolean;
    v_ok boolean;
    v_denied boolean := false;
    v_budget record;
BEGIN
    SELECT out_reservation_id, out_reserved_usd, out_threshold, out_inserted
      INTO v_id, v_reserved, v_threshold, v_inserted
      FROM vc.reserve_model_cost(
          current_setting('t.user')::bigint, 101, 'attempt-cost-1',
          'provider-cost', 'model-cost', 1000, 1000, 1.00);
    IF NOT v_inserted OR v_reserved <> 0.300000 OR v_threshold <> 'NONE' THEN
        RAISE EXCEPTION 'initial reservation mismatch: % % %', v_reserved, v_threshold, v_inserted;
    END IF;

    -- Retry of the same work/provider reuses one hold and rebinds attempt id.
    SELECT out_reservation_id, out_reserved_usd, out_inserted
      INTO v_id, v_reserved, v_inserted
      FROM vc.reserve_model_cost(
          current_setting('t.user')::bigint, 101, 'attempt-cost-1-retry',
          'provider-cost', 'model-cost', 1000, 1000, 1.00);
    IF v_inserted OR v_reserved <> 0.300000 THEN
        RAISE EXCEPTION 'retry must reuse the hold';
    END IF;
    IF vc.release_model_cost('attempt-cost-1') THEN
        RAISE EXCEPTION 'old retry attempt id must no longer own the hold';
    END IF;
    IF NOT vc.release_model_cost('attempt-cost-1-retry')
       OR vc.release_model_cost('attempt-cost-1-retry') THEN
        RAISE EXCEPTION 'release must be idempotent';
    END IF;

    -- Actual settlement uses the frozen price version and is idempotent.
    PERFORM * FROM vc.reserve_model_cost(
        current_setting('t.user')::bigint, 102, 'attempt-cost-2',
        'provider-cost', 'model-cost', 1000, 1000, 1.00);
    SELECT out_actual_usd, out_changed INTO v_actual, v_changed
      FROM vc.settle_model_cost('attempt-cost-2', 500, 500);
    IF v_actual <> 0.150000 OR NOT v_changed THEN
        RAISE EXCEPTION 'settlement mismatch: % %', v_actual, v_changed;
    END IF;
    SELECT out_actual_usd, out_changed INTO v_actual, v_changed
      FROM vc.settle_model_cost('attempt-cost-2', 500, 500);
    IF v_actual <> 0.150000 OR v_changed THEN
        RAISE EXCEPTION 'repeat settlement must be idempotent';
    END IF;

    SELECT * INTO v_budget FROM vc.model_cost_budget_snapshot();
    IF v_budget.out_reserved_usd <> 0 OR v_budget.out_settled_usd <> 0.150000 THEN
        RAISE EXCEPTION 'budget snapshot mismatch: % %',
            v_budget.out_reserved_usd, v_budget.out_settled_usd;
    END IF;

    -- Exactly reaching the cap is admitted once and emits fixed 100% threshold.
    SELECT out_threshold INTO v_threshold FROM vc.reserve_model_cost(
        current_setting('t.user')::bigint, 103, 'attempt-cost-3',
        'provider-cost', 'model-cost', 1000, 1000, 0.45);
    IF v_threshold <> 'BUDGET_100' THEN
        RAISE EXCEPTION 'exact cap must report BUDGET_100, got %', v_threshold;
    END IF;
    PERFORM vc.release_model_cost('attempt-cost-3');

    BEGIN
        PERFORM * FROM vc.reserve_model_cost(
            current_setting('t.user')::bigint, 104, 'attempt-unknown-price',
            'unknown-provider', 'unknown-model', 1, 1, 1.00);
    EXCEPTION WHEN others THEN
        v_denied := SQLERRM LIKE '%unit price is unknown%';
    END;
    IF NOT v_denied THEN
        RAISE EXCEPTION 'unknown price must fail closed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Concurrent reservations serialize on the month row: only one 0.60 hold fits.
TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
UPDATE vc.model_unit_price
   SET input_usd_per_1k = 0, output_usd_per_1k = 0.10, effective_from = now() - interval '1 day'
 WHERE provider_id = 'provider-cost' AND model_id = 'model-cost' AND price_version = 1;

CREATE OR REPLACE FUNCTION vc.test_concurrent_cost_reserve(
    p_owner bigint, p_work bigint, p_attempt text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE v_nonce text := gen_random_uuid()::text; v_proof text;
BEGIN
    v_proof := vc._owner_binding_expected(p_owner, v_nonce);
    PERFORM vc.set_owner_context(p_owner, v_nonce, v_proof);
    BEGIN
        PERFORM * FROM vc.reserve_model_cost(
            p_owner, p_work, p_attempt, 'provider-cost', 'model-cost', 0, 6000, 1.00);
        RETURN TRUE;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%monthly cap exceeded%' THEN RETURN FALSE; END IF;
        RAISE;
    END;
END;
$$;

DO $$
DECLARE a boolean; b boolean; v_count integer; v_reserved numeric;
BEGIN
    PERFORM dblink_connect('cost_a', 'dbname=vc');
    PERFORM dblink_connect('cost_b', 'dbname=vc');
    PERFORM dblink_send_query('cost_a', format(
        'SELECT vc.test_concurrent_cost_reserve(%s, 201, %L)',
        current_setting('t.user'), 'attempt-concurrent-a'));
    PERFORM dblink_send_query('cost_b', format(
        'SELECT vc.test_concurrent_cost_reserve(%s, 202, %L)',
        current_setting('t.user'), 'attempt-concurrent-b'));
    SELECT ok INTO a FROM dblink_get_result('cost_a') AS t(ok boolean);
    SELECT ok INTO b FROM dblink_get_result('cost_b') AS t(ok boolean);
    IF (a::int + b::int) <> 1 THEN
        RAISE EXCEPTION 'exactly one concurrent reservation must fit: % %', a, b;
    END IF;
    SELECT count(*), max(reserved_usd) INTO v_count, v_reserved
      FROM vc.model_cost_reservation WHERE status = 'HELD';
    IF v_count <> 1 OR v_reserved <> 0.600000 THEN
        RAISE EXCEPTION 'concurrent budget invariant failed: % %', v_count, v_reserved;
    END IF;
    PERFORM dblink_disconnect('cost_a');
    PERFORM dblink_disconnect('cost_b');
END $$;
DROP FUNCTION vc.test_concurrent_cost_reserve(bigint, bigint, text);

INSERT INTO vc.account_deletion_intent(account_id, username_digest)
VALUES (current_setting('t.user')::bigint,
        vc.username_tombstone_digest('user-model-cost'));

DO $$
DECLARE v_status text; v_owner bigint; v_reserved numeric;
BEGIN
    SELECT status, owner_user_id INTO v_status, v_owner
      FROM vc.model_cost_reservation WHERE status = 'RELEASED'
      ORDER BY id DESC LIMIT 1;
    SELECT reserved_usd INTO v_reserved FROM vc.month_cost_budget
     WHERE month_start = date_trunc('month', now())::date;
    IF v_status <> 'RELEASED' OR v_owner IS NOT NULL OR v_reserved <> 0 THEN
        RAISE EXCEPTION 'deletion must release/scrub held model cost: % % %',
            v_status, v_owner, v_reserved;
    END IF;
END $$;

DO $$
BEGIN
    IF has_table_privilege('vc_api', 'vc.model_cost_reservation', 'SELECT,INSERT,UPDATE,DELETE')
       OR has_table_privilege('vc_worker', 'vc.month_cost_budget', 'UPDATE') THEN
        RAISE EXCEPTION 'runtime roles must not directly mutate/read cost ledger tables';
    END IF;
END $$;
