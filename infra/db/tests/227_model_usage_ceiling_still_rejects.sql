-- W11-3b: an estimate above the per-call ceiling is still refused, and no
-- reservation row is inserted. An estimate equal to the ceiling is accepted
-- and the hold is that ceiling (min of the two equal numbers).

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (22701, 'w11 ceiling owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22701, 'w11-227-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

DO $$
DECLARE r record; n integer; v_reserved numeric;
BEGIN
    PERFORM vc.set_owner_context(22701, 'm227', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|22701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m227',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));

    -- 1_000_001 input tokens at 0.001 USD per 1k is 1.000001, over a 1 USD ceiling.
    BEGIN
        PERFORM 1 FROM vc.reserve_model_usage(
            22701, 'FOREGROUND_CHAT', 'fg-227-over', 'w11-meter', 'priced', 1000001, 0, 1000000, 8000000);
        RAISE EXCEPTION 'service estimate over the ceiling was reserved';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%service estimate over the ceiling was reserved%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%model usage ceiling is too small%' THEN
            RAISE EXCEPTION 'service ceiling denial %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM vc.go_hold_model_cost(
            22701, 22711, 'memory-extract:22711', 'w11-meter', 'priced', 1000001, 0, 1000000, 8000000,
            'MEMORY_EXTRACTION_DEDUP_SUMMARY');
        RAISE EXCEPTION 'worker estimate over the ceiling was reserved';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%worker estimate over the ceiling was reserved%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%model cost reservation ceiling is too small%' THEN
            RAISE EXCEPTION 'worker ceiling denial %', SQLERRM;
        END IF;
    END;
    SELECT count(*) INTO n FROM vc.model_cost_reservation
     WHERE provider_attempt_id IN ('fg-227-over', 'memory-extract:22711');
    IF n <> 0 THEN RAISE EXCEPTION 'over-ceiling rows %', n; END IF;

    -- Exactly 1 USD of input is the ceiling. The hold is that amount.
    SELECT * INTO r FROM vc.reserve_model_usage(
        22701, 'TOOL_TURN', 'tool-227-equal', 'w11-meter', 'priced', 1000000, 0, 1000000, 8000000);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '1.000000' THEN
        RAISE EXCEPTION 'equal service hold %', r.out_reserved_usd;
    END IF;
    PERFORM vc.go_hold_model_cost(
        22701, 22712, 'follow-up:22712', 'w11-meter', 'priced', 1000000, 0, 1000000, 8000000,
        'BACKGROUND_GREETINGS');
    SELECT reserved_usd INTO v_reserved FROM vc.model_cost_reservation
     WHERE provider_attempt_id = 'follow-up:22712';
    IF v_reserved IS DISTINCT FROM 1.000000 THEN
        RAISE EXCEPTION 'equal worker hold %', v_reserved;
    END IF;
END $$;
