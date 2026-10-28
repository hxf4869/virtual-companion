-- W11-3b: a reservation holds the priced token cap, not the whole per-call
-- ceiling. p_output / p_output_tokens is this request's output limit, not an
-- expected length. The hold is
-- min(ceiling, round((input * input_price + output * output_price) / 1000, 6)).
-- An estimate above the ceiling is still refused. UNKNOWN keeps this hold.
-- Settlement still uses reported usage. The monthly cap is unchanged:
-- settled + reserved + unsettled. Signatures stay the same, so existing
-- grants remain. V105 reserve_model_cost is already an estimate and is not
-- replaced.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.reserve_model_usage(
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
    v_ceiling_usd numeric(18,6);
    v_estimate numeric(18,6);
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
    -- p_output is this request's output cap. Hold that priced cap, at most
    -- the per-call ceiling. Compare the rounded six-decimal estimate.
    v_ceiling_usd := p_ceiling::numeric / 1000000;
    v_estimate := round((p_input * v_price.input_usd_per_1k
        + p_output * v_price.output_usd_per_1k) / 1000, 6);
    IF v_estimate > v_ceiling_usd THEN
        RAISE EXCEPTION 'model usage ceiling is too small';
    END IF;
    v_hold := least(v_ceiling_usd, v_estimate);
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

-- 10-arg worker hold used by memory extraction and greetings. The 9-arg
-- wrapper delegates here, so it keeps its inferred purpose unchanged.
CREATE OR REPLACE FUNCTION vc.go_hold_model_cost(
    p_owner bigint, p_job bigint, p_attempt text,
    p_provider text, p_model text, p_input_tokens bigint, p_output_tokens bigint,
    p_ceiling bigint, p_monthly_limit bigint, p_purpose text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_price vc.model_unit_price%ROWTYPE;
    v_month date := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_ceiling_usd numeric(18,6);
    v_estimate numeric(18,6);
    v_hold numeric(18,6);
    v_spend numeric;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_purpose IS NULL OR p_purpose NOT IN (
        'FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY', 'BACKGROUND_GREETINGS',
        'TOOL_TURN', 'LEGACY_CHAT') THEN
        RAISE EXCEPTION 'model cost limits are not configured';
    END IF;
    IF p_ceiling IS NULL OR p_ceiling <= 0 OR p_monthly_limit IS NULL OR p_monthly_limit <= 0 THEN
        RAISE EXCEPTION 'model cost limits are not configured';
    END IF;
    SELECT * INTO v_price FROM vc.model_unit_price
     WHERE provider_id = p_provider AND model_id = p_model
       AND active AND effective_from <= clock_timestamp()
     ORDER BY price_version DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'model cost unit price is unknown';
    END IF;
    -- p_output_tokens is this request's output cap. Hold that priced cap, at
    -- most the per-call ceiling. A later UNKNOWN keeps this amount.
    v_ceiling_usd := p_ceiling::numeric / 1000000;
    v_estimate := round((p_input_tokens * v_price.input_usd_per_1k
        + p_output_tokens * v_price.output_usd_per_1k) / 1000, 6);
    IF v_estimate > v_ceiling_usd THEN
        RAISE EXCEPTION 'model cost reservation ceiling is too small';
    END IF;
    v_hold := least(v_ceiling_usd, v_estimate);
    INSERT INTO vc.month_cost_budget(month_start) VALUES (v_month)
    ON CONFLICT (month_start) DO NOTHING;
    SELECT reserved_usd + settled_usd + unsettled_usd INTO v_spend
      FROM vc.month_cost_budget
     WHERE month_start = v_month FOR UPDATE;
    IF v_spend + v_hold > p_monthly_limit::numeric / 1000000 THEN
        RAISE EXCEPTION 'monthly cost hard cap exceeded';
    END IF;
    UPDATE vc.month_cost_budget SET reserved_usd = reserved_usd + v_hold
     WHERE month_start = v_month;
    INSERT INTO vc.model_cost_reservation(
        owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
        price_version, month_start, estimated_input_tokens, estimated_output_tokens,
        input_usd_per_1k, output_usd_per_1k, reserved_usd, purpose)
    VALUES (p_owner, p_job, p_attempt, p_provider, p_model,
        v_price.price_version, v_month, p_input_tokens, p_output_tokens,
        v_price.input_usd_per_1k, v_price.output_usd_per_1k, v_hold, p_purpose);
END;
$$;
