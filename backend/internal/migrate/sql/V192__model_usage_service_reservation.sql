-- W11-3: foreground and tool-turn reservations on the shared month pool.
-- The service channel names an ACTIVE owner. Messages stay distinct from the
-- worker hold path so existing cap mapping is unchanged.
-- The same attempt may resume only while it is still HELD for the same
-- owner, purpose, provider and model. A settled, unknown, or released
-- attempt is not reusable. Settlement of one reservation is idempotent.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.reserve_model_usage(
    p_owner bigint,
    p_purpose text,
    p_attempt text,
    p_provider text,
    p_model text,
    p_input bigint,
    p_output bigint,
    p_ceiling bigint,
    p_monthly bigint)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_purpose text,
        out_status text,
        out_reserved_usd text,
        out_attempt text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_price vc.model_unit_price%ROWTYPE;
    v_month date := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_hold numeric(18,6);
    v_spend numeric;
    v_existing vc.model_cost_reservation%ROWTYPE;
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    IF p_purpose IS NULL OR p_purpose NOT IN ('FOREGROUND_CHAT', 'TOOL_TURN') THEN
        RAISE EXCEPTION 'model usage purpose is not reservable';
    END IF;
    IF p_attempt IS NULL OR btrim(p_attempt) = ''
       OR p_provider IS NULL OR btrim(p_provider) = ''
       OR p_model IS NULL OR btrim(p_model) = ''
       OR p_input IS NULL OR p_input < 0
       OR p_output IS NULL OR p_output < 0 THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF p_ceiling IS NULL OR p_ceiling <= 0 OR p_monthly IS NULL OR p_monthly <= 0 THEN
        RAISE EXCEPTION 'model usage limits are not configured';
    END IF;

    SELECT * INTO v_existing FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_attempt FOR UPDATE;
    IF FOUND THEN
        IF v_existing.status = 'HELD'
           AND v_existing.owner_user_id = p_owner
           AND v_existing.purpose = p_purpose
           AND v_existing.provider_id = p_provider
           AND v_existing.model_id = p_model THEN
            RETURN QUERY SELECT v_existing.id, v_existing.purpose, v_existing.status,
                to_char(v_existing.reserved_usd, 'FM999999999999990.000000'),
                v_existing.provider_attempt_id;
            RETURN;
        END IF;
        RAISE EXCEPTION 'model usage reservation is not reusable';
    END IF;

    SELECT * INTO v_price FROM vc.model_unit_price
     WHERE provider_id = p_provider AND model_id = p_model
       AND active AND effective_from <= clock_timestamp()
     ORDER BY price_version DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'model usage unit price is unknown';
    END IF;
    v_hold := p_ceiling::numeric / 1000000;
    IF (p_input * v_price.input_usd_per_1k + p_output * v_price.output_usd_per_1k) / 1000 > v_hold THEN
        RAISE EXCEPTION 'model usage ceiling is too small';
    END IF;
    INSERT INTO vc.month_cost_budget(month_start) VALUES (v_month)
    ON CONFLICT (month_start) DO NOTHING;

    BEGIN
        SELECT reserved_usd + settled_usd + unsettled_usd INTO v_spend
          FROM vc.month_cost_budget
         WHERE month_start = v_month FOR UPDATE;
        IF v_spend + v_hold > p_monthly::numeric / 1000000 THEN
            RAISE EXCEPTION 'model usage monthly cap exceeded';
        END IF;
        UPDATE vc.month_cost_budget
           SET reserved_usd = reserved_usd + v_hold
         WHERE month_start = v_month;
        INSERT INTO vc.model_cost_reservation(
            owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
            price_version, month_start, estimated_input_tokens, estimated_output_tokens,
            input_usd_per_1k, output_usd_per_1k, reserved_usd, purpose)
        VALUES (
            p_owner, NULL, p_attempt, p_provider, p_model,
            v_price.price_version, v_month, p_input, p_output,
            v_price.input_usd_per_1k, v_price.output_usd_per_1k, v_hold, p_purpose)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_existing FROM vc.model_cost_reservation
         WHERE provider_attempt_id = p_attempt;
        IF v_existing.status = 'HELD'
           AND v_existing.owner_user_id = p_owner
           AND v_existing.purpose = p_purpose
           AND v_existing.provider_id = p_provider
           AND v_existing.model_id = p_model THEN
            RETURN QUERY SELECT v_existing.id, v_existing.purpose, v_existing.status,
                to_char(v_existing.reserved_usd, 'FM999999999999990.000000'),
                v_existing.provider_attempt_id;
            RETURN;
        END IF;
        RAISE EXCEPTION 'model usage reservation is not reusable';
    END;
    RETURN QUERY SELECT v_id, p_purpose, 'HELD'::text,
        to_char(v_hold, 'FM999999999999990.000000'), p_attempt;
END;
$$;

CREATE FUNCTION vc.settle_model_usage_reservation(
    p_owner bigint,
    p_reservation_id bigint,
    p_input bigint,
    p_output bigint)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_purpose text,
        out_status text,
        out_actual_usd text,
        out_input_tokens bigint,
        out_output_tokens bigint,
        out_idempotent boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
    v_actual numeric(18,6);
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    IF p_reservation_id IS NULL OR p_input IS NULL OR p_input < 0
       OR p_output IS NULL OR p_output < 0 THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    SELECT * INTO v_row FROM vc.model_cost_reservation
     WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND OR v_row.owner_user_id IS DISTINCT FROM p_owner
       OR v_row.purpose NOT IN ('FOREGROUND_CHAT', 'TOOL_TURN') THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF v_row.status = 'SETTLED' THEN
        RETURN QUERY SELECT v_row.id, v_row.purpose, v_row.status,
            to_char(v_row.actual_usd, 'FM999999999999990.000000'),
            v_row.actual_input_tokens, v_row.actual_output_tokens, true;
        RETURN;
    END IF;
    IF v_row.status <> 'HELD' THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    PERFORM 1 FROM vc.month_cost_budget
     WHERE month_start = v_row.month_start FOR UPDATE;
    v_actual := round((p_input * v_row.input_usd_per_1k
                     + p_output * v_row.output_usd_per_1k) / 1000, 6);
    UPDATE vc.month_cost_budget
       SET reserved_usd = greatest(0, reserved_usd - v_row.reserved_usd),
           settled_usd = settled_usd + v_actual
     WHERE month_start = v_row.month_start;
    UPDATE vc.model_cost_reservation
       SET status = 'SETTLED',
           actual_input_tokens = p_input,
           actual_output_tokens = p_output,
           actual_usd = v_actual,
           settled_at = clock_timestamp()
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_row.id, v_row.purpose, 'SETTLED'::text,
        to_char(v_actual, 'FM999999999999990.000000'), p_input, p_output, false;
END;
$$;

CREATE FUNCTION vc.cancel_model_usage_reservation(
    p_owner bigint,
    p_reservation_id bigint,
    p_disposition text)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_purpose text,
        out_status text,
        out_reserved_usd text,
        out_actual_usd text,
        out_idempotent boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    IF p_disposition IS NULL OR p_disposition NOT IN ('NOT_SENT', 'UNKNOWN') THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    SELECT * INTO v_row FROM vc.model_cost_reservation
     WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND OR v_row.owner_user_id IS DISTINCT FROM p_owner
       OR v_row.purpose NOT IN ('FOREGROUND_CHAT', 'TOOL_TURN') THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF v_row.status = 'UNKNOWN' AND p_disposition = 'UNKNOWN' THEN
        RETURN QUERY SELECT v_row.id, v_row.purpose, v_row.status,
            to_char(v_row.reserved_usd, 'FM999999999999990.000000'),
            NULL::text, true;
        RETURN;
    END IF;
    IF v_row.status = 'RELEASED' AND p_disposition = 'NOT_SENT' THEN
        RETURN QUERY SELECT v_row.id, v_row.purpose, v_row.status,
            to_char(v_row.reserved_usd, 'FM999999999999990.000000'),
            NULL::text, true;
        RETURN;
    END IF;
    IF v_row.status <> 'HELD' THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF p_disposition = 'NOT_SENT' THEN
        PERFORM vc.release_model_cost(v_row.provider_attempt_id);
        RETURN QUERY SELECT v_row.id, v_row.purpose, 'RELEASED'::text,
            to_char(v_row.reserved_usd, 'FM999999999999990.000000'),
            NULL::text, false;
        RETURN;
    END IF;
    PERFORM vc.mark_model_cost_unknown(v_row.provider_attempt_id);
    RETURN QUERY SELECT v_row.id, v_row.purpose, 'UNKNOWN'::text,
        to_char(v_row.reserved_usd, 'FM999999999999990.000000'),
        NULL::text, false;
END;
$$;

REVOKE ALL ON FUNCTION
    vc.reserve_model_usage(bigint, text, text, text, text, bigint, bigint, bigint, bigint),
    vc.settle_model_usage_reservation(bigint, bigint, bigint, bigint),
    vc.cancel_model_usage_reservation(bigint, bigint, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.reserve_model_usage(bigint, text, text, text, text, bigint, bigint, bigint, bigint),
    vc.settle_model_usage_reservation(bigint, bigint, bigint, bigint),
    vc.cancel_model_usage_reservation(bigint, bigint, text)
    TO vc_api;
