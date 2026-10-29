-- W16-1: a HELD reservation older than the caller's bound becomes UNKNOWN.
-- The priced hold moves into the monthly unsettled total and is not released
-- as zero. A younger hold is left HELD. Another owner cannot settle the row.
-- A late settle of the swept attempt stays UNKNOWN with a null actual.
--
-- model_cost_reservation and month_cost_budget have no SELECT grant for the
-- runtime roles. Those roles call the granted functions. Row checks run as
-- the table owner after the role transaction ends. go_settle_held_model_cost
-- is not granted to vc_api; the worker path is the internal function, called
-- here as the owner after the service settle has committed.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w16-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (25101, 'w16 sweep owner'), (25102, 'w16 sweep other')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (25101, 'w16-251-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
       (25102, 'w16-251-other', 'synthetic', 'USER', 'ACTIVE', 'other')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE';

CREATE TEMP TABLE sweep251 (aged_id bigint, young_id bigint);
INSERT INTO sweep251 VALUES (NULL, NULL);
GRANT ALL ON TABLE sweep251 TO vc_api;

BEGIN;
SELECT vc.set_owner_context(25101, 'm251a', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|25101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m251a',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM vc.reserve_model_usage(
        25101, 'FOREGROUND_CHAT', 'fg-251-aged', 'w16-meter', 'priced', 10, 10, 1000000, 8000000);
    IF r.out_reserved_usd IS DISTINCT FROM '0.000030' THEN
        RAISE EXCEPTION 'aged hold %', r.out_reserved_usd;
    END IF;
    UPDATE sweep251 SET aged_id = r.out_reservation_id;
END $$;
COMMIT;

BEGIN;
SELECT vc.set_owner_context(25102, 'm251b', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|25102|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m251b',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE r record;
BEGIN
    SELECT * INTO r FROM vc.reserve_model_usage(
        25102, 'TOOL_TURN', 'tool-251-young', 'w16-meter', 'priced', 10, 10, 1000000, 8000000);
    IF r.out_status IS DISTINCT FROM 'HELD' THEN
        RAISE EXCEPTION 'young hold %', r.out_status;
    END IF;
    UPDATE sweep251 SET young_id = r.out_reservation_id;
END $$;
COMMIT;

UPDATE vc.model_cost_reservation
   SET created_at = clock_timestamp() - interval '2 hours'
 WHERE provider_attempt_id = 'fg-251-aged';

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
DECLARE v_n integer;
BEGIN
    SELECT vc.sweep_expired_model_cost_holds(360) INTO v_n;
    IF v_n IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'sweep count %', v_n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_status text; v_actual numeric; v_settled numeric; v_held numeric; v_unsettled numeric;
BEGIN
    SELECT status, actual_usd INTO v_status, v_actual
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-251-aged';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL THEN
        RAISE EXCEPTION 'aged % %', v_status, v_actual;
    END IF;
    SELECT status INTO v_status
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'tool-251-young';
    IF v_status IS DISTINCT FROM 'HELD' THEN
        RAISE EXCEPTION 'young became %', v_status;
    END IF;
    SELECT settled_usd, reserved_usd, unsettled_usd INTO v_settled, v_held, v_unsettled
      FROM vc.month_cost_budget;
    IF v_settled IS DISTINCT FROM 0 OR v_held IS DISTINCT FROM 0.000030 OR v_unsettled IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'month settled % reserved % unsettled %', v_settled, v_held, v_unsettled;
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(25102, 'm251c', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|25102|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m251c',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_id bigint;
BEGIN
    SELECT aged_id INTO v_id FROM sweep251;
    BEGIN
        PERFORM 1 FROM vc.settle_model_usage_reservation(25102, v_id, 10, 4);
        RAISE EXCEPTION 'cross owner settled';
    EXCEPTION
        WHEN OTHERS THEN
            IF SQLERRM NOT LIKE '%model usage reservation not found%' THEN
                RAISE;
            END IF;
    END;
END $$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(25101, 'm251d', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|25101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m251d',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_id bigint; s record;
BEGIN
    SELECT aged_id INTO v_id FROM sweep251;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(25101, v_id, 10, 4);
    IF s.out_status IS DISTINCT FROM 'UNKNOWN' OR s.out_idempotent IS DISTINCT FROM true
       OR s.out_actual_usd IS NOT NULL OR s.out_input_tokens IS NOT NULL THEN
        RAISE EXCEPTION 'late settle % % % %', s.out_status, s.out_idempotent, s.out_actual_usd, s.out_input_tokens;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_worker bigint; v_unsettled numeric; v_status text; v_actual numeric;
BEGIN
    SELECT unsettled_usd INTO v_unsettled FROM vc.month_cost_budget;
    IF v_unsettled IS DISTINCT FROM 0.000030 THEN
        RAISE EXCEPTION 'late settle moved unsettled %', v_unsettled;
    END IF;
    SELECT vc.go_settle_held_model_cost('fg-251-aged', 'USAGE_REPORTED', 10, 4) INTO v_worker;
    IF v_worker IS NOT NULL THEN
        RAISE EXCEPTION 'worker late settle %', v_worker;
    END IF;
    SELECT status, actual_usd INTO v_status, v_actual
      FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fg-251-aged';
    IF v_status IS DISTINCT FROM 'UNKNOWN' OR v_actual IS NOT NULL THEN
        RAISE EXCEPTION 'worker settle rewrote the unknown hold % %', v_status, v_actual;
    END IF;
END $$;
