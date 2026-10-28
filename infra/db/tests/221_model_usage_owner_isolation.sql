-- W11-3: a foreground reservation stores its purpose. Another owner cannot
-- settle, cancel, or read it.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002)
ON CONFLICT (provider_id, model_id, price_version) DO NOTHING;
INSERT INTO vc.vc_user(id, display_name) VALUES (22101, 'w11 meter owner'), (22102, 'w11 meter other')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (22101, 'w11-221-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
    (22102, 'w11-221-other', 'synthetic', 'USER', 'ACTIVE', 'other')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

CREATE TEMP TABLE meter221 (id bigint);
INSERT INTO meter221 VALUES (NULL);
GRANT ALL ON TABLE meter221 TO vc_api;

CREATE FUNCTION pg_temp.meter_owner(p_owner bigint, p_label text) RETURNS void
    LANGUAGE plpgsql AS $fn$
BEGIN
    PERFORM vc.set_owner_context(p_owner, p_label, encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|' || p_owner::text || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || p_label,
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
END $fn$;

-- set_owner_context is transaction-local. The proof, role, and call share
-- one transaction, the same shape as test 220.
BEGIN;
SELECT pg_temp.meter_owner(22101, 'm221a');
SET LOCAL ROLE vc_api;
DO $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM vc.reserve_model_usage(
        22101, 'FOREGROUND_CHAT', 'fg-221', 'w11-meter', 'priced', 10, 10, 1000000, 4000000);
    IF r.out_purpose IS DISTINCT FROM 'FOREGROUND_CHAT' OR r.out_status IS DISTINCT FROM 'HELD'
       OR r.out_reserved_usd IS DISTINCT FROM '1.000000' OR r.out_reservation_id IS NULL THEN
        RAISE EXCEPTION 'reserve got %', r;
    END IF;
    UPDATE meter221 SET id = r.out_reservation_id;
END $$;

DO $$
BEGIN
    PERFORM 1 FROM vc.model_cost_reservation;
    RAISE EXCEPTION 'vc_api read the cost ledger';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT pg_temp.meter_owner(22102, 'm221b');
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_id bigint;
BEGIN
    SELECT id INTO v_id FROM meter221;
    BEGIN
        PERFORM 1 FROM vc.settle_model_usage_reservation(22102, v_id, 1, 1);
        RAISE EXCEPTION 'other owner settled';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%other owner settled%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not found%' THEN
            RAISE EXCEPTION 'settle denial %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM 1 FROM vc.cancel_model_usage_reservation(22102, v_id, 'NOT_SENT');
        RAISE EXCEPTION 'other owner cancelled';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%other owner cancelled%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not found%' THEN
            RAISE EXCEPTION 'cancel denial %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_purpose text; v_status text; v_owner bigint;
BEGIN
    SELECT purpose, status, owner_user_id INTO v_purpose, v_status, v_owner
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-221';
    IF v_purpose IS DISTINCT FROM 'FOREGROUND_CHAT' OR v_status IS DISTINCT FROM 'HELD' OR v_owner IS DISTINCT FROM 22101 THEN
        RAISE EXCEPTION 'stored reservation % % %', v_purpose, v_status, v_owner;
    END IF;
END $$;
