-- W11-3b: a small call reserves the priced token cap, not the per-call ceiling.
-- 10 input and 10 output at 0.001/0.002 USD per 1k is 0.000030.
-- The ceiling argument stays 1.000000 USD and is not the hold.
-- estimated output is this request's output cap, not an expected length.
-- The worker hold (go_hold_model_cost) uses the same estimate.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (22501, 'w11 estimate owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22501, 'w11-225-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

DO $$
DECLARE r record; v_reserved numeric;
BEGIN
    PERFORM vc.set_owner_context(22501, 'm225', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|22501|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m225',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT * INTO r FROM vc.reserve_model_usage(
        22501, 'FOREGROUND_CHAT', 'fg-225', 'w11-meter', 'priced', 10, 10, 1000000, 8000000);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000030' THEN
        RAISE EXCEPTION 'small hold reserved % want estimate 0.000030 not ceiling 1.000000', r.out_reserved_usd;
    END IF;
    PERFORM vc.go_hold_model_cost(
        22501, 22511, 'memory-extract:22511', 'w11-meter', 'priced', 10, 10, 1000000, 8000000,
        'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    SELECT reserved_usd INTO v_reserved FROM vc.model_cost_reservation
     WHERE provider_attempt_id = 'memory-extract:22511';
    IF v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'worker hold % want estimate 0.000030 not ceiling 1', v_reserved;
    END IF;
    SELECT reserved_usd INTO v_reserved FROM vc.model_cost_reservation
     WHERE provider_attempt_id = 'fg-225';
    IF v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'stored service hold %', v_reserved;
    END IF;
END $$;
