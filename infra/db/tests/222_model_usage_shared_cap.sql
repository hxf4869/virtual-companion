-- W11-3: foreground, tool, extraction and greeting spend one month cap.
-- A hold that would exceed the cap fails. After a real release, the next
-- purpose can hold.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002)
ON CONFLICT (provider_id, model_id, price_version) DO NOTHING;
INSERT INTO vc.vc_user(id, display_name) VALUES (22201, 'w11 cap owner') ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (22201, 'w11-222-owner', 'synthetic', 'USER', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

CREATE TEMP TABLE meter222 (id bigint);
GRANT ALL ON TABLE meter222 TO vc_api;

CREATE FUNCTION pg_temp.meter_owner(p_owner bigint, p_label text) RETURNS void
    LANGUAGE plpgsql AS $fn$
BEGIN
    PERFORM vc.set_owner_context(p_owner, p_label, encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|' || p_owner::text || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || p_label,
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
END $fn$;

BEGIN;
SELECT pg_temp.meter_owner(22201, 'm222');
SET LOCAL ROLE vc_api;
DO $$
DECLARE r record; v_id bigint;
BEGIN
    SELECT * INTO r FROM vc.reserve_model_usage(
        22201, 'FOREGROUND_CHAT', 'fg-222', 'w11-meter', 'priced', 10, 10, 1000000, 1000000);
    v_id := r.out_reservation_id;
    INSERT INTO meter222 VALUES (v_id);
    BEGIN
        PERFORM 1 FROM vc.reserve_model_usage(
            22201, 'TOOL_TURN', 'tool-222', 'w11-meter', 'priced', 10, 10, 1000000, 1000000);
        RAISE EXCEPTION 'tool hold crossed the cap';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%tool hold crossed the cap%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%model usage monthly cap exceeded%' THEN
            RAISE EXCEPTION 'cap denial %', SQLERRM;
        END IF;
    END;
    PERFORM 1 FROM vc.cancel_model_usage_reservation(22201, v_id, 'NOT_SENT');
    PERFORM vc.go_hold_model_cost(
        22201, 22211, 'memory-extract:22211', 'w11-meter', 'priced', 10, 10, 1000000, 1000000,
        'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    PERFORM vc.go_hold_model_cost(
        22201, 22212, 'follow-up:22212', 'w11-meter', 'priced', 10, 10, 1000000, 4000000,
        'BACKGROUND_GREETINGS');
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE n integer; v_status text; v_spend numeric;
BEGIN
    SELECT count(*) INTO n FROM vc.model_cost_reservation WHERE purpose = 'TOOL_TURN';
    IF n <> 0 THEN RAISE EXCEPTION 'tool row leaked %', n; END IF;
    SELECT status INTO v_status FROM vc.model_cost_reservation WHERE purpose = 'FOREGROUND_CHAT';
    IF v_status IS DISTINCT FROM 'RELEASED' THEN RAISE EXCEPTION 'foreground %', v_status; END IF;
    SELECT count(*) INTO n FROM vc.model_cost_reservation
     WHERE purpose IN ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 'BACKGROUND_GREETINGS') AND status = 'HELD';
    IF n <> 2 THEN RAISE EXCEPTION 'shared pool holds %', n; END IF;
    SELECT reserved_usd + settled_usd + unsettled_usd INTO v_spend FROM vc.month_cost_budget;
    IF v_spend IS DISTINCT FROM 2.000000 THEN RAISE EXCEPTION 'spend %', v_spend; END IF;
END $$;
