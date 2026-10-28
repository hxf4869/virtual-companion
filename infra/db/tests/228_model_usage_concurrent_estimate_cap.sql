-- W11-3b: two concurrent small holds serialize on the month row. Each
-- estimate is 0.000030 and the monthly cap is exactly one estimate, so
-- exactly one reservation lands. The stored hold is the estimate, not the
-- 1 USD ceiling, and the month spend does not exceed the cap.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (22801, 'w11 concurrent owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22801, 'w11-228-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

CREATE OR REPLACE FUNCTION vc.test_w11_estimate_reserve(p_owner bigint, p_attempt text)
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
        PERFORM 1 FROM vc.reserve_model_usage(
            p_owner, 'FOREGROUND_CHAT', p_attempt, 'w11-meter', 'priced', 10, 10, 1000000, 30);
        RETURN TRUE;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '%model usage monthly cap exceeded%' THEN RETURN FALSE; END IF;
        RAISE;
    END;
END;
$$;

DO $$
DECLARE a boolean; b boolean; v_count integer; v_reserved numeric; v_spend numeric;
BEGIN
    PERFORM dblink_connect('est_a', 'dbname=vc');
    PERFORM dblink_connect('est_b', 'dbname=vc');
    PERFORM dblink_send_query('est_a',
        'SELECT vc.test_w11_estimate_reserve(22801, ''fg-228-a'')');
    PERFORM dblink_send_query('est_b',
        'SELECT vc.test_w11_estimate_reserve(22801, ''fg-228-b'')');
    SELECT ok INTO a FROM dblink_get_result('est_a') AS t(ok boolean);
    SELECT ok INTO b FROM dblink_get_result('est_b') AS t(ok boolean);
    IF (a::int + b::int) <> 1 THEN
        RAISE EXCEPTION 'exactly one concurrent reservation must fit: % %', a, b;
    END IF;
    SELECT count(*), max(reserved_usd) INTO v_count, v_reserved
      FROM vc.model_cost_reservation WHERE status = 'HELD';
    IF v_count <> 1 OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'concurrent hold count % reserved % want one estimate 0.000030', v_count, v_reserved;
    END IF;
    SELECT reserved_usd + settled_usd + unsettled_usd INTO v_spend FROM vc.month_cost_budget;
    IF v_spend IS DISTINCT FROM 0.000030 OR v_spend > 0.000030 THEN
        RAISE EXCEPTION 'concurrent spend % exceeds the 0.000030 cap', v_spend;
    END IF;
    PERFORM dblink_disconnect('est_a');
    PERFORM dblink_disconnect('est_b');
END $$;

DROP FUNCTION vc.test_w11_estimate_reserve(bigint, text);
