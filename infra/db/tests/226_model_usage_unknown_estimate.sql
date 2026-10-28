-- W11-3b: a timeout stays UNKNOWN and keeps the priced estimate, not the
-- per-call ceiling and not zero. Settlement is not involved. Both the
-- service cancel path and the worker mark-unknown path count that estimate.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (22601, 'w11 unknown estimate') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22601, 'w11-226-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

DO $$
DECLARE r record; v_status text; v_actual numeric; v_reserved numeric;
        v_settled numeric; v_unsettled numeric; v_held numeric;
BEGIN
    PERFORM vc.set_owner_context(22601, 'm226', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|22601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m226',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT * INTO r FROM vc.reserve_model_usage(
        22601, 'FOREGROUND_CHAT', 'fg-226', 'w11-meter', 'priced', 10, 10, 1000000, 8000000);
    IF r.out_reserved_usd IS DISTINCT FROM '0.000030' THEN
        RAISE EXCEPTION 'service hold % want 0.000030 not ceiling 1.000000', r.out_reserved_usd;
    END IF;
    PERFORM 1 FROM vc.cancel_model_usage_reservation(22601, r.out_reservation_id, 'UNKNOWN');
    PERFORM vc.go_hold_model_cost(
        22601, 22611, 'follow-up:22611', 'w11-meter', 'priced', 10, 10, 1000000, 8000000,
        'BACKGROUND_GREETINGS');
    PERFORM vc.mark_model_cost_unknown('follow-up:22611');

    SELECT status, actual_usd, reserved_usd INTO v_status, v_actual, v_reserved
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-226';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'service timeout % % %', v_status, v_actual, v_reserved;
    END IF;
    SELECT status, actual_usd, reserved_usd INTO v_status, v_actual, v_reserved
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'follow-up:22611';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'worker timeout % % %', v_status, v_actual, v_reserved;
    END IF;
    SELECT settled_usd, reserved_usd, unsettled_usd INTO v_settled, v_held, v_unsettled
      FROM vc.month_cost_budget;
    IF v_settled IS DISTINCT FROM 0 OR v_held IS DISTINCT FROM 0 OR v_unsettled IS DISTINCT FROM 0.000060 THEN
        RAISE EXCEPTION 'month settled % reserved % unsettled %', v_settled, v_held, v_unsettled;
    END IF;
END $$;
