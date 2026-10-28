-- W11-3b: settlement still books actual usage. A 1000/1000 cap holds
-- 0.003000, not the 1 USD ceiling. Settling 100 input and 50 output books
-- 0.000200 and releases the hold. The month does not keep the estimate or
-- the ceiling.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (22901, 'w11 settle owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22901, 'w11-229-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

DO $$
DECLARE r record; s record; v_settled numeric; v_reserved numeric; v_unsettled numeric;
BEGIN
    PERFORM vc.set_owner_context(22901, 'm229', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|22901|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m229',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT * INTO r FROM vc.reserve_model_usage(
        22901, 'FOREGROUND_CHAT', 'fg-229', 'w11-meter', 'priced', 1000, 1000, 1000000, 8000000);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.003000' THEN
        RAISE EXCEPTION 'hold % want estimate 0.003000 not ceiling 1.000000', r.out_reserved_usd;
    END IF;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(22901, r.out_reservation_id, 100, 50);
    IF s.out_idempotent OR s.out_status IS DISTINCT FROM 'SETTLED'
       OR s.out_actual_usd IS DISTINCT FROM '0.000200'
       OR s.out_input_tokens IS DISTINCT FROM 100 OR s.out_output_tokens IS DISTINCT FROM 50 THEN
        RAISE EXCEPTION 'settle %', s;
    END IF;
    SELECT settled_usd, reserved_usd, unsettled_usd INTO v_settled, v_reserved, v_unsettled
      FROM vc.month_cost_budget;
    IF v_settled IS DISTINCT FROM 0.000200 OR v_reserved IS DISTINCT FROM 0 OR v_unsettled IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'month settled % reserved % unsettled %', v_settled, v_reserved, v_unsettled;
    END IF;
END $$;
