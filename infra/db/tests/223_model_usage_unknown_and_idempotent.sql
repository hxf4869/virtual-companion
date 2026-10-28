-- W11-3: a timeout stays UNKNOWN with its priced estimate, not a zero actual
-- and not the 1 USD ceiling. A second real send is a new reservation.
-- Settling the same reservation twice does not add the actual twice.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002)
ON CONFLICT (provider_id, model_id, price_version) DO NOTHING;
INSERT INTO vc.vc_user(id, display_name) VALUES (22301, 'w11 unknown owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22301, 'w11-223-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

CREATE TEMP TABLE meter223 (unknown_id bigint, settled_id bigint);
INSERT INTO meter223 VALUES (NULL, NULL);
GRANT ALL ON TABLE meter223 TO vc_api;

CREATE FUNCTION pg_temp.meter_owner(p_owner bigint, p_label text) RETURNS void
    LANGUAGE plpgsql AS $fn$
BEGIN
    PERFORM vc.set_owner_context(p_owner, p_label, encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|' || p_owner::text || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || p_label,
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
END $fn$;

BEGIN;
SELECT pg_temp.meter_owner(22301, 'm223');
SET LOCAL ROLE vc_api;
DO $$
DECLARE r record; s1 record; s2 record;
BEGIN
    SELECT * INTO r FROM vc.reserve_model_usage(
        22301, 'FOREGROUND_CHAT', 'fg-223-timeout', 'w11-meter', 'priced', 10, 10, 1000000, 8000000);
    UPDATE meter223 SET unknown_id = r.out_reservation_id;
    PERFORM 1 FROM vc.cancel_model_usage_reservation(22301, r.out_reservation_id, 'UNKNOWN');
    SELECT * INTO r FROM vc.reserve_model_usage(
        22301, 'TOOL_TURN', 'tool-223-send', 'w11-meter', 'priced', 1000, 1000, 1000000, 8000000);
    UPDATE meter223 SET settled_id = r.out_reservation_id;
    SELECT * INTO s1 FROM vc.settle_model_usage_reservation(22301, r.out_reservation_id, 1000, 1000);
    SELECT * INTO s2 FROM vc.settle_model_usage_reservation(22301, r.out_reservation_id, 5000, 5000);
    IF s1.out_idempotent OR NOT s2.out_idempotent OR s1.out_actual_usd IS DISTINCT FROM '0.003000'
       OR s2.out_actual_usd IS DISTINCT FROM s1.out_actual_usd
       OR s2.out_input_tokens IS DISTINCT FROM 1000 THEN
        RAISE EXCEPTION 'settle % / %', s1, s2;
    END IF;
    BEGIN
        PERFORM 1 FROM vc.reserve_model_usage(
            22301, 'TOOL_TURN', 'tool-223-send', 'w11-meter', 'priced', 10, 10, 1000000, 8000000);
        RAISE EXCEPTION 'settled attempt was reused';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%settled attempt was reused%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not reusable%' THEN
            RAISE EXCEPTION 'reuse denial %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_status text; v_actual numeric; v_reserved numeric; v_settled numeric; v_unsettled numeric; n integer;
BEGIN
    SELECT status, actual_usd, reserved_usd INTO v_status, v_actual, v_reserved
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-223-timeout';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL OR v_reserved IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'timeout row % % %', v_status, v_actual, v_reserved;
    END IF;
    SELECT settled_usd, reserved_usd, unsettled_usd INTO v_settled, v_reserved, v_unsettled FROM vc.month_cost_budget;
    IF v_settled IS DISTINCT FROM 0.003000 OR v_reserved IS DISTINCT FROM 0 OR v_unsettled IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'month % % %', v_settled, v_reserved, v_unsettled;
    END IF;
    SELECT count(*) INTO n FROM vc.model_cost_reservation WHERE provider_attempt_id = 'tool-223-send';
    IF n <> 1 THEN RAISE EXCEPTION 'second send rows %', n; END IF;
    SELECT count(*) INTO n FROM vc.model_cost_reservation;
    IF n <> 2 THEN RAISE EXCEPTION 'reservation rows %', n; END IF;
END $$;
