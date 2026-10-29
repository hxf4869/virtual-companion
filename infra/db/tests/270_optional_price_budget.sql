-- V2-F01: a missing USD price still reserves and settles with a NULL fee.
-- VC_MONTHLY_COST_LIMIT is p_monthly in micro-USD. Zero is unset and does
-- not reject a priced send. A positive cap with no per-call ceiling still
-- refuses. Cache tokens stay NULL when the caller omits them.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('w11-meter', 'priced', 1, 0.001, 0.002, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES
    (27001, 'f01 owner'),
    (27002, 'f01 other'),
    (27009, 'f01 admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (27001, 'f01-270-owner', 'synthetic', 'USER', 'ACTIVE', 'owner'),
    (27002, 'f01-270-other', 'synthetic', 'USER', 'ACTIVE', 'other'),
    (27009, 'f01-270-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin')
ON CONFLICT (id) DO UPDATE SET status = 'ACTIVE', role = EXCLUDED.role;

DO $$
DECLARE
    r record;
    s record;
    v_id bigint;
    v_again bigint;
    v_settled numeric;
    v_unpriced bigint;
    v_cached bigint;
    v_includes boolean;
    v_actual text;
BEGIN
    PERFORM vc.set_owner_context(27001, 'm270', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|27001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m270',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));

    SELECT * INTO r FROM vc.reserve_model_usage(
        27001, 'FOREGROUND_CHAT', 'fg-270-free', 'w11-meter', 'unpriced', 12, 7, 0, 0);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000000' THEN
        RAISE EXCEPTION 'unpriced reserve % %', r.out_status, r.out_reserved_usd;
    END IF;
    v_id := r.out_reservation_id;
    SELECT * INTO r FROM vc.reserve_model_usage(
        27001, 'FOREGROUND_CHAT', 'fg-270-free', 'w11-meter', 'unpriced', 12, 7, 0, 0);
    IF r.out_reservation_id IS DISTINCT FROM v_id OR r.out_reserved_usd IS DISTINCT FROM '0.000000' THEN
        RAISE EXCEPTION 'unpriced retry %', r.out_reservation_id;
    END IF;

    SELECT COALESCE(settled_usd, 0) INTO v_settled FROM vc.month_cost_budget
     WHERE month_start = date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_settled := COALESCE(v_settled, 0);
    SELECT * INTO s FROM vc.settle_model_usage_reservation(27001, v_id, 12, 7, 4);
    IF s.out_status IS DISTINCT FROM 'SETTLED' OR s.out_actual_usd IS NOT NULL
       OR s.out_input_tokens IS DISTINCT FROM 12 OR s.out_output_tokens IS DISTINCT FROM 7
       OR s.out_cached_input_tokens IS DISTINCT FROM 4 OR s.out_idempotent THEN
        RAISE EXCEPTION 'unpriced settle %', s;
    END IF;
    IF (SELECT actual_usd FROM vc.model_cost_reservation WHERE id = v_id) IS NOT NULL THEN
        RAISE EXCEPTION 'unpriced fee was stored';
    END IF;
    IF COALESCE((SELECT settled_usd FROM vc.month_cost_budget
                  WHERE month_start = date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date), 0)
       IS DISTINCT FROM v_settled THEN
        RAISE EXCEPTION 'unpriced settlement moved the month';
    END IF;

    SELECT * INTO s FROM vc.settle_model_usage_reservation(27001, v_id, 12, 7, NULL);
    IF NOT s.out_idempotent OR s.out_cached_input_tokens IS DISTINCT FROM 4 OR s.out_actual_usd IS NOT NULL THEN
        RAISE EXCEPTION 'unpriced resettle %', s;
    END IF;

    PERFORM vc.go_hold_model_cost(
        27001, 27011, 'memory-extract:27011', 'w11-meter', 'unpriced', 3, 1, 0, 0,
        'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    IF (SELECT reserved_usd FROM vc.model_cost_reservation WHERE provider_attempt_id = 'memory-extract:27011')
       IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'memory unpriced hold was priced';
    END IF;

    SELECT * INTO r FROM vc.reserve_model_usage(
        27001, 'TOOL_TURN', 'tool-270', 'w11-meter', 'priced', 10, 10, 0, 0);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000030' THEN
        RAISE EXCEPTION 'priced without cap % %', r.out_status, r.out_reserved_usd;
    END IF;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(27001, r.out_reservation_id, 10, 4, NULL);
    IF s.out_actual_usd IS DISTINCT FROM '0.000018' OR s.out_cached_input_tokens IS NOT NULL THEN
        RAISE EXCEPTION 'priced settle without cap %', s;
    END IF;

    BEGIN
        PERFORM vc.reserve_model_usage(
            27001, 'FOREGROUND_CHAT', 'fg-270-cap', 'w11-meter', 'priced', 10, 10, 1000000, 1);
        RAISE EXCEPTION 'tiny cap admitted a priced send';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%tiny cap admitted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%monthly cap exceeded%' THEN
            RAISE EXCEPTION 'cap denial %', SQLERRM;
        END IF;
    END;

    BEGIN
        PERFORM vc.reserve_model_usage(
            27001, 'FOREGROUND_CHAT', 'fg-270-ceiling', 'w11-meter', 'priced', 10, 10, 0, 8000000);
        RAISE EXCEPTION 'missing ceiling admitted a capped send';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%missing ceiling admitted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%limits are not configured%' THEN
            RAISE EXCEPTION 'ceiling denial %', SQLERRM;
        END IF;
    END;

    v_again := v_id;
    PERFORM vc.set_owner_context(27002, 'm270b', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|27002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m270b',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    BEGIN
        PERFORM 1 FROM vc.settle_model_usage_reservation(27002, v_again, 1, 1, 1);
        RAISE EXCEPTION 'other owner settled';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%other owner settled%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not found%' THEN
            RAISE EXCEPTION 'settle denial %', SQLERRM;
        END IF;
    END;

    SELECT out_unpriced_calls, out_cached_input_tokens, out_includes_unpriced, out_actual_usd
      INTO v_unpriced, v_cached, v_includes, v_actual
      FROM vc.admin_model_usage_summary(
          27009,
          date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC'),
          date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') + interval '1 month')
     WHERE out_purpose = 'FOREGROUND_CHAT';
    IF v_unpriced < 1 OR v_cached IS DISTINCT FROM 4 OR NOT v_includes OR v_actual IS NOT NULL THEN
        RAISE EXCEPTION 'summary unpriced=% cached=% includes=% actual=%', v_unpriced, v_cached, v_includes, v_actual;
    END IF;
    BEGIN
        PERFORM 1 FROM vc.admin_model_usage_summary(27001, now() - interval '1 day');
        RAISE EXCEPTION 'non-admin read the summary';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-admin read the summary%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
            RAISE EXCEPTION 'summary denial %', SQLERRM;
        END IF;
    END;
END $$;
