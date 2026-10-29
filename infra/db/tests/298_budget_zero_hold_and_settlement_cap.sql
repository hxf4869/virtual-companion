-- Both unit prices at 0 stay free under a monthly cap. A non-zero price whose
-- estimate rounds to 0 reserves 0.000001 USD and still faces the cap.
-- Settlement posts only the remaining monthly room and records the excess
-- as overflow. Overflow is not admission spend. actual_usd stays the true fee.

\set ON_ERROR_STOP on

TRUNCATE vc.model_cost_reservation, vc.month_cost_budget;
INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k, active)
VALUES ('fix-go-budget', 'meter', 1, 1, 0, true),
       ('fix-go-budget', 'free', 1, 0, 0, true),
       ('fix-go-budget', 'tiny', 1, 0.000001, 0, true)
ON CONFLICT (provider_id, model_id, price_version) DO UPDATE
   SET input_usd_per_1k = EXCLUDED.input_usd_per_1k,
       output_usd_per_1k = EXCLUDED.output_usd_per_1k,
       active = true;
INSERT INTO vc.vc_user(id, display_name) VALUES (29801, 'fix budget owner')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (29801, 'fix-298-owner', 'synthetic', 'ADMIN', 'ACTIVE', 'owner')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE';

DO $$
DECLARE
    r record;
    s record;
    v_first bigint;
    v_second bigint;
BEGIN
    PERFORM vc.set_owner_context(29801, 'm298', encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|29801|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m298',
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));

    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-free', 'fix-go-budget', 'free', 1000, 1000, 5000000, 10000000);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000000' THEN
        RAISE EXCEPTION 'free hold % %', r.out_status, r.out_reserved_usd;
    END IF;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(29801, r.out_reservation_id, 1000, 1000, NULL);
    IF s.out_actual_usd IS DISTINCT FROM '0.000000'
       OR (SELECT settled_usd + reserved_usd + unsettled_usd FROM vc.month_cost_budget) IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'free settlement occupied the cap %', s.out_actual_usd;
    END IF;

    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-tiny', 'fix-go-budget', 'tiny', 1, 0, 5000000, 10000000);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000001' THEN
        RAISE EXCEPTION 'tiny hold % %', r.out_status, r.out_reserved_usd;
    END IF;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(29801, r.out_reservation_id, 1, 0, NULL);
    IF s.out_actual_usd IS DISTINCT FROM '0.000000'
       OR (SELECT settled_usd + reserved_usd + unsettled_usd FROM vc.month_cost_budget) IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'tiny settlement left spend %', s.out_actual_usd;
    END IF;

    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-zero', 'fix-go-budget', 'meter', 0, 0, 5000000, 10000000);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000001' THEN
        RAISE EXCEPTION 'zero-token non-zero price % %', r.out_status, r.out_reserved_usd;
    END IF;
    PERFORM vc.settle_model_usage_reservation(29801, r.out_reservation_id, 0, 0, NULL);

    PERFORM vc.go_hold_model_cost(
        29801, 29811, 'memory-extract:29811', 'fix-go-budget', 'meter', 0, 0, 5000000, 10000000,
        'MEMORY_EXTRACTION_DEDUP_SUMMARY');
    IF (SELECT reserved_usd FROM vc.model_cost_reservation WHERE provider_attempt_id = 'memory-extract:29811')
       IS DISTINCT FROM 0.000001 THEN
        RAISE EXCEPTION 'memory minimum hold missing';
    END IF;
    PERFORM vc.settle_model_cost('memory-extract:29811', 0, 0, NULL::bigint);
    IF (SELECT settled_usd + reserved_usd + unsettled_usd FROM vc.month_cost_budget) IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'minimum holds were not released';
    END IF;

    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-zero-open', 'fix-go-budget', 'meter', 0, 0, 5000000, 0);
    IF r.out_status IS DISTINCT FROM 'HELD' OR r.out_reserved_usd IS DISTINCT FROM '0.000000' THEN
        RAISE EXCEPTION 'uncapped zero hold % %', r.out_status, r.out_reserved_usd;
    END IF;

    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-hold-1', 'fix-go-budget', 'meter', 4000, 0, 5000000, 10000000);
    IF r.out_reserved_usd IS DISTINCT FROM '4.000000' THEN
        RAISE EXCEPTION 'first hold %', r.out_reserved_usd;
    END IF;
    v_first := r.out_reservation_id;
    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-hold-2', 'fix-go-budget', 'meter', 4000, 0, 5000000, 10000000);
    IF r.out_reserved_usd IS DISTINCT FROM '4.000000' THEN
        RAISE EXCEPTION 'second hold %', r.out_reserved_usd;
    END IF;
    v_second := r.out_reservation_id;

    SELECT * INTO s FROM vc.settle_model_usage_reservation(29801, v_first, 8000, 0, NULL);
    IF s.out_actual_usd IS DISTINCT FROM '8.000000' THEN
        RAISE EXCEPTION 'first actual %', s.out_actual_usd;
    END IF;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(29801, v_second, 8000, 0, NULL);
    IF s.out_actual_usd IS DISTINCT FROM '8.000000' THEN
        RAISE EXCEPTION 'second actual %', s.out_actual_usd;
    END IF;

    IF (SELECT reserved_usd FROM vc.month_cost_budget) IS DISTINCT FROM 0
       OR (SELECT settled_usd FROM vc.month_cost_budget) IS DISTINCT FROM 10
       OR (SELECT overflow_usd FROM vc.month_cost_budget) IS DISTINCT FROM 6
       OR (SELECT cap_usd FROM vc.month_cost_budget) IS DISTINCT FROM 10
       OR (SELECT reserved_usd + settled_usd + unsettled_usd FROM vc.month_cost_budget) IS DISTINCT FROM 10 THEN
        RAISE EXCEPTION 'month pool %', (SELECT row_to_json(b) FROM vc.month_cost_budget b);
    END IF;
    IF (SELECT actual_usd FROM vc.model_cost_reservation WHERE id = v_first) IS DISTINCT FROM 8
       OR (SELECT overflow_usd FROM vc.model_cost_reservation WHERE id = v_first) IS DISTINCT FROM 2
       OR (SELECT actual_usd FROM vc.model_cost_reservation WHERE id = v_second) IS DISTINCT FROM 8
       OR (SELECT overflow_usd FROM vc.model_cost_reservation WHERE id = v_second) IS DISTINCT FROM 4 THEN
        RAISE EXCEPTION 'reservation overflow drifted';
    END IF;

    BEGIN
        PERFORM vc.reserve_model_usage(
            29801, 'FOREGROUND_CHAT', 'fix-tiny-full', 'fix-go-budget', 'tiny', 1, 0, 5000000, 10000000);
        RAISE EXCEPTION 'full cap admitted a minimum hold';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%full cap admitted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%monthly cap exceeded%' THEN
            RAISE EXCEPTION 'tiny cap denial %', SQLERRM;
        END IF;
    END;
    IF EXISTS (SELECT 1 FROM vc.model_cost_reservation WHERE provider_attempt_id = 'fix-tiny-full') THEN
        RAISE EXCEPTION 'rejected minimum hold inserted a row';
    END IF;

    SELECT * INTO r FROM vc.reserve_model_usage(
        29801, 'FOREGROUND_CHAT', 'fix-free-full', 'fix-go-budget', 'free', 1000, 1000, 5000000, 10000000);
    IF r.out_reserved_usd IS DISTINCT FROM '0.000000' THEN
        RAISE EXCEPTION 'free hold on a full cap %', r.out_reserved_usd;
    END IF;
    SELECT * INTO s FROM vc.settle_model_usage_reservation(29801, r.out_reservation_id, 1000, 1000, NULL);
    IF s.out_actual_usd IS DISTINCT FROM '0.000000'
       OR (SELECT reserved_usd FROM vc.month_cost_budget) IS DISTINCT FROM 0
       OR (SELECT settled_usd FROM vc.month_cost_budget) IS DISTINCT FROM 10
       OR (SELECT overflow_usd FROM vc.month_cost_budget) IS DISTINCT FROM 6 THEN
        RAISE EXCEPTION 'free settlement on a full cap moved the pool';
    END IF;
END $$;
