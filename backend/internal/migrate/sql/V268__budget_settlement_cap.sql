-- Monthly admission stays on reserved + settled + unsettled. A settlement whose
-- actual fee exceeds the room left under the stored cap posts only that room
-- and records the rest as overflow_usd. Overflow is not admission spend.
-- Both unit prices at 0 are free: a zero hold is admitted and settles at 0
-- without consuming admission spend. A non-zero price whose estimate rounds
-- to 0 is raised to the 0.000001 USD unit so the cap check still applies.
-- actual_usd on the reservation stays the true fee.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.month_cost_budget
    ADD COLUMN overflow_usd numeric NOT NULL DEFAULT 0,
    ADD COLUMN cap_usd numeric,
    ADD CONSTRAINT month_cost_budget_overflow_nonneg CHECK (overflow_usd >= 0),
    ADD CONSTRAINT month_cost_budget_cap_nonneg CHECK (cap_usd IS NULL OR cap_usd >= 0);

ALTER TABLE vc.model_cost_reservation
    ADD COLUMN overflow_usd numeric,
    ADD CONSTRAINT model_cost_reservation_overflow_nonneg
        CHECK (overflow_usd IS NULL OR overflow_usd >= 0);

-- Posts min(actual, remaining cap room) into settled_usd and keeps the excess
-- on overflow_usd. cap_usd NULL means the monthly cap is unset.
CREATE FUNCTION vc.book_priced_model_settlement(
    p_month date,
    p_reserved numeric,
    p_actual numeric)
    RETURNS TABLE(out_booked numeric, out_overflow numeric)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_reserved numeric;
    v_settled numeric;
    v_unsettled numeric;
    v_cap numeric;
    v_spend numeric;
    v_room numeric;
    v_booked numeric;
    v_overflow numeric := 0;
BEGIN
    SELECT reserved_usd, settled_usd, unsettled_usd, cap_usd
      INTO v_reserved, v_settled, v_unsettled, v_cap
      FROM vc.month_cost_budget
     WHERE month_start = p_month
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    v_booked := p_actual;
    IF v_cap IS NOT NULL AND v_cap > 0 THEN
        v_spend := COALESCE(v_reserved, 0) + COALESCE(v_settled, 0) + COALESCE(v_unsettled, 0);
        v_room := v_cap - (v_spend - COALESCE(p_reserved, 0));
        IF v_room < 0 THEN
            v_room := 0;
        END IF;
        IF p_actual > v_room THEN
            v_booked := v_room;
            v_overflow := p_actual - v_room;
        END IF;
    END IF;
    UPDATE vc.month_cost_budget
       SET reserved_usd = greatest(0, reserved_usd - COALESCE(p_reserved, 0)),
           settled_usd = settled_usd + v_booked,
           overflow_usd = overflow_usd + v_overflow
     WHERE month_start = p_month;
    RETURN QUERY SELECT v_booked, v_overflow;
END;
$$;

REVOKE ALL ON FUNCTION vc.book_priced_model_settlement(date, numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.book_priced_model_settlement(date, numeric, numeric)
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT EXECUTE ON FUNCTION vc.book_priced_model_settlement(date, numeric, numeric) TO CURRENT_USER;

CREATE OR REPLACE FUNCTION vc.insert_model_usage_hold(
    p_owner bigint,
    p_job bigint,
    p_attempt text,
    p_provider text,
    p_model text,
    p_purpose text,
    p_input bigint,
    p_output bigint,
    p_ceiling bigint,
    p_monthly bigint)
    RETURNS TABLE(out_id bigint, out_hold numeric, out_error text)
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
    v_id bigint;
BEGIN
    SELECT * INTO v_price FROM vc.model_unit_price
     WHERE provider_id = p_provider AND model_id = p_model
       AND active AND effective_from <= clock_timestamp()
     ORDER BY price_version DESC LIMIT 1;
    IF NOT FOUND THEN
        INSERT INTO vc.model_cost_reservation(
            owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
            price_version, month_start, estimated_input_tokens, estimated_output_tokens,
            input_usd_per_1k, output_usd_per_1k, reserved_usd, purpose)
        VALUES (
            p_owner, p_job, p_attempt, p_provider, p_model,
            NULL, v_month, p_input, p_output,
            NULL, NULL, 0, p_purpose)
        RETURNING id INTO v_id;
        RETURN QUERY SELECT v_id, 0::numeric, NULL::text;
        RETURN;
    END IF;

    -- A positive p_monthly is the cap from VC_MONTHLY_COST_LIMIT. Zero means
    -- the cap is unset. The per-call ceiling is required only while a cap is set.
    IF p_monthly IS NULL OR (p_monthly > 0 AND (p_ceiling IS NULL OR p_ceiling <= 0)) THEN
        RETURN QUERY SELECT NULL::bigint, NULL::numeric, 'LIMITS'::text;
        RETURN;
    END IF;
    v_estimate := round((p_input * v_price.input_usd_per_1k
        + p_output * v_price.output_usd_per_1k) / 1000, 6);
    IF p_monthly > 0 THEN
        v_ceiling_usd := p_ceiling::numeric / 1000000;
        -- Free models stay at a zero hold. Any other rounded-to-zero estimate
        -- takes the minimum billing unit and then the ceiling and cap checks.
        IF v_estimate <= 0
           AND (v_price.input_usd_per_1k <> 0 OR v_price.output_usd_per_1k <> 0) THEN
            v_estimate := 0.000001;
        END IF;
        IF v_estimate > v_ceiling_usd THEN
            RETURN QUERY SELECT NULL::bigint, NULL::numeric, 'CEILING'::text;
            RETURN;
        END IF;
        v_hold := least(v_ceiling_usd, v_estimate);
    ELSE
        v_hold := v_estimate;
    END IF;

    INSERT INTO vc.month_cost_budget(month_start) VALUES (v_month)
    ON CONFLICT (month_start) DO NOTHING;
    SELECT reserved_usd + settled_usd + unsettled_usd INTO v_spend
      FROM vc.month_cost_budget
     WHERE month_start = v_month FOR UPDATE;
    IF p_monthly > 0 AND v_spend + v_hold > p_monthly::numeric / 1000000 THEN
        RETURN QUERY SELECT NULL::bigint, NULL::numeric, 'CAP'::text;
        RETURN;
    END IF;
    UPDATE vc.month_cost_budget
       SET reserved_usd = reserved_usd + v_hold,
           cap_usd = CASE
               WHEN p_monthly > 0 THEN p_monthly::numeric / 1000000
               ELSE NULL
           END
     WHERE month_start = v_month;
    INSERT INTO vc.model_cost_reservation(
        owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
        price_version, month_start, estimated_input_tokens, estimated_output_tokens,
        input_usd_per_1k, output_usd_per_1k, reserved_usd, purpose)
    VALUES (
        p_owner, p_job, p_attempt, p_provider, p_model,
        v_price.price_version, v_month, p_input, p_output,
        v_price.input_usd_per_1k, v_price.output_usd_per_1k, v_hold, p_purpose)
    RETURNING id INTO v_id;
    RETURN QUERY SELECT v_id, v_hold, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION vc.settle_model_usage_reservation(
    p_owner bigint,
    p_reservation_id bigint,
    p_input bigint,
    p_output bigint,
    p_cached bigint)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_purpose text,
        out_status text,
        out_actual_usd text,
        out_input_tokens bigint,
        out_output_tokens bigint,
        out_cached_input_tokens bigint,
        out_idempotent boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
    v_actual numeric(18,6);
    v_booked numeric;
    v_overflow numeric;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    IF p_reservation_id IS NULL OR p_input IS NULL OR p_input < 0
       OR p_output IS NULL OR p_output < 0
       OR (p_cached IS NOT NULL AND p_cached < 0) THEN
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
            CASE WHEN v_row.actual_usd IS NULL THEN NULL
                 ELSE to_char(v_row.actual_usd, 'FM999999999999990.000000') END,
            v_row.actual_input_tokens, v_row.actual_output_tokens,
            v_row.cached_input_tokens, true;
        RETURN;
    END IF;
    IF v_row.status = 'UNKNOWN' THEN
        RETURN QUERY SELECT v_row.id, v_row.purpose, v_row.status,
            NULL::text, NULL::bigint, NULL::bigint, NULL::bigint, true;
        RETURN;
    END IF;
    IF v_row.status <> 'HELD' THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF v_row.price_version IS NULL THEN
        UPDATE vc.model_cost_reservation
           SET status = 'SETTLED',
               actual_input_tokens = p_input,
               actual_output_tokens = p_output,
               cached_input_tokens = p_cached,
               actual_usd = NULL,
               settled_at = clock_timestamp()
         WHERE id = v_row.id;
        RETURN QUERY SELECT v_row.id, v_row.purpose, 'SETTLED'::text,
            NULL::text, p_input, p_output, p_cached, false;
        RETURN;
    END IF;
    v_actual := round((p_input * v_row.input_usd_per_1k
                     + p_output * v_row.output_usd_per_1k) / 1000, 6);
    SELECT b.out_booked, b.out_overflow
      INTO v_booked, v_overflow
      FROM vc.book_priced_model_settlement(v_row.month_start, v_row.reserved_usd, v_actual) b;
    UPDATE vc.model_cost_reservation
       SET status = 'SETTLED',
           actual_input_tokens = p_input,
           actual_output_tokens = p_output,
           cached_input_tokens = p_cached,
           actual_usd = v_actual,
           overflow_usd = v_overflow,
           settled_at = clock_timestamp()
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_row.id, v_row.purpose, 'SETTLED'::text,
        to_char(v_actual, 'FM999999999999990.000000'), p_input, p_output, p_cached, false;
END;
$$;

CREATE OR REPLACE FUNCTION vc.settle_model_cost(
    p_provider_attempt_id text,
    p_actual_input_tokens bigint,
    p_actual_output_tokens bigint,
    p_cached bigint)
    RETURNS TABLE(out_actual_usd numeric, out_changed boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_reservation vc.model_cost_reservation%ROWTYPE;
    v_actual numeric(18,6);
    v_booked numeric;
    v_overflow numeric;
BEGIN
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = ''
       OR p_actual_input_tokens IS NULL OR p_actual_input_tokens < 0
       OR p_actual_output_tokens IS NULL OR p_actual_output_tokens < 0
       OR (p_cached IS NOT NULL AND p_cached < 0) THEN
        RAISE EXCEPTION 'settle_model_cost: invalid settlement';
    END IF;
    SELECT * INTO v_reservation FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_provider_attempt_id FOR UPDATE;
    IF v_reservation.id IS NULL THEN
        RAISE EXCEPTION 'settle_model_cost: reservation not found';
    END IF;
    IF v_reservation.status = 'SETTLED' THEN
        RETURN QUERY SELECT v_reservation.actual_usd, false;
        RETURN;
    END IF;
    IF v_reservation.status <> 'HELD' THEN
        RAISE EXCEPTION 'settle_model_cost: reservation was released';
    END IF;
    IF v_reservation.price_version IS NULL THEN
        UPDATE vc.model_cost_reservation
           SET status = 'SETTLED',
               actual_input_tokens = p_actual_input_tokens,
               actual_output_tokens = p_actual_output_tokens,
               cached_input_tokens = p_cached,
               actual_usd = NULL,
               settled_at = clock_timestamp()
         WHERE id = v_reservation.id;
        RETURN QUERY SELECT NULL::numeric, true;
        RETURN;
    END IF;
    v_actual := round((p_actual_input_tokens * v_reservation.input_usd_per_1k
                     + p_actual_output_tokens * v_reservation.output_usd_per_1k) / 1000, 6);
    SELECT b.out_booked, b.out_overflow
      INTO v_booked, v_overflow
      FROM vc.book_priced_model_settlement(
          v_reservation.month_start, v_reservation.reserved_usd, v_actual) b;
    UPDATE vc.model_cost_reservation
       SET status = 'SETTLED',
           actual_input_tokens = p_actual_input_tokens,
           actual_output_tokens = p_actual_output_tokens,
           cached_input_tokens = p_cached,
           actual_usd = v_actual,
           overflow_usd = v_overflow,
           settled_at = clock_timestamp()
     WHERE id = v_reservation.id;
    RETURN QUERY SELECT v_actual, true;
END;
$$;
