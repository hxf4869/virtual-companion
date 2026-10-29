-- V2-F01: unit price and the monthly cap are optional.
-- VC_MONTHLY_COST_LIMIT (micro-USD, passed as p_monthly) is the only cap.
-- Zero or a negative p_monthly means the cap is unset: priced sends record
-- the actual fee and are not rejected. An effective USD price is still held
-- as an estimate when a cap is set. No effective price still inserts one
-- idempotent usage row; settlement stores tokens and a NULL fee (never 0)
-- and does not move month_cost_budget. Cache tokens are NULL when the
-- provider omits them.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.model_cost_reservation
    ALTER COLUMN price_version DROP NOT NULL,
    ALTER COLUMN input_usd_per_1k DROP NOT NULL,
    ALTER COLUMN output_usd_per_1k DROP NOT NULL,
    ADD COLUMN cached_input_tokens bigint;

ALTER TABLE vc.model_cost_reservation
    DROP CONSTRAINT model_cost_reservation_terminal_shape;

ALTER TABLE vc.model_cost_reservation
    ADD CONSTRAINT model_cost_reservation_cached_nonneg
        CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0),
    ADD CONSTRAINT model_cost_reservation_price_shape CHECK (
        (price_version IS NULL AND input_usd_per_1k IS NULL
            AND output_usd_per_1k IS NULL AND reserved_usd = 0)
        OR (price_version IS NOT NULL AND input_usd_per_1k IS NOT NULL
            AND output_usd_per_1k IS NOT NULL)),
    ADD CONSTRAINT model_cost_reservation_terminal_shape CHECK (
        (status = 'HELD' AND settled_at IS NULL AND released_at IS NULL
            AND unknown_at IS NULL AND actual_usd IS NULL)
        OR (status = 'SETTLED' AND settled_at IS NOT NULL AND released_at IS NULL
            AND unknown_at IS NULL AND (
                (price_version IS NOT NULL AND actual_usd IS NOT NULL)
                OR (price_version IS NULL AND actual_usd IS NULL
                    AND actual_input_tokens IS NOT NULL
                    AND actual_output_tokens IS NOT NULL)))
        OR (status = 'RELEASED' AND released_at IS NOT NULL AND settled_at IS NULL
            AND unknown_at IS NULL AND actual_usd IS NULL)
        OR (status = 'UNKNOWN' AND unknown_at IS NOT NULL AND settled_at IS NULL
            AND released_at IS NULL AND actual_usd IS NULL AND (
                (price_version IS NOT NULL AND reserved_usd > 0)
                OR reserved_usd = 0)));

ALTER TABLE vc.memory_extract_attempt
    ADD COLUMN cached_input_tokens bigint,
    ADD CONSTRAINT memory_extract_attempt_cached_nonneg
        CHECK (cached_input_tokens IS NULL OR cached_input_tokens >= 0);

-- Inserts one hold. out_error is LIMITS, CEILING, or CAP; NULL means the row
-- was inserted. Unpriced rows reserve 0 and do not touch the month pool.
CREATE FUNCTION vc.insert_model_usage_hold(
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
       SET reserved_usd = reserved_usd + v_hold
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
    v_existing vc.model_cost_reservation%ROWTYPE;
    v_ins record;
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
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

    BEGIN
        SELECT * INTO v_ins FROM vc.insert_model_usage_hold(
            p_owner, NULL, p_attempt, p_provider, p_model, p_purpose,
            p_input, p_output, p_ceiling, p_monthly);
        IF v_ins.out_error = 'LIMITS' THEN
            RAISE EXCEPTION 'model usage limits are not configured';
        ELSIF v_ins.out_error = 'CEILING' THEN
            RAISE EXCEPTION 'model usage ceiling is too small';
        ELSIF v_ins.out_error = 'CAP' THEN
            RAISE EXCEPTION 'model usage monthly cap exceeded';
        END IF;
        v_id := v_ins.out_id;
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
        to_char(COALESCE(v_ins.out_hold, 0), 'FM999999999999990.000000'), p_attempt;
END;
$$;

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
    v_ins record;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_purpose IS NULL OR p_purpose NOT IN (
        'FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY', 'BACKGROUND_GREETINGS',
        'TOOL_TURN', 'LEGACY_CHAT') THEN
        RAISE EXCEPTION 'model cost limits are not configured';
    END IF;
    IF p_attempt IS NULL OR btrim(p_attempt) = ''
       OR p_provider IS NULL OR btrim(p_provider) = ''
       OR p_model IS NULL OR btrim(p_model) = ''
       OR p_input_tokens IS NULL OR p_input_tokens < 0
       OR p_output_tokens IS NULL OR p_output_tokens < 0
       OR p_job IS NULL OR p_job <= 0 THEN
        RAISE EXCEPTION 'model cost reservation not found';
    END IF;
    SELECT * INTO v_ins FROM vc.insert_model_usage_hold(
        p_owner, p_job, p_attempt, p_provider, p_model, p_purpose,
        p_input_tokens, p_output_tokens, p_ceiling, p_monthly_limit);
    IF v_ins.out_error = 'LIMITS' THEN
        RAISE EXCEPTION 'model cost limits are not configured';
    ELSIF v_ins.out_error = 'CEILING' THEN
        RAISE EXCEPTION 'model cost reservation ceiling is too small';
    ELSIF v_ins.out_error = 'CAP' THEN
        RAISE EXCEPTION 'monthly cost hard cap exceeded';
    END IF;
END;
$$;

-- Five-arg settle carries cache tokens. The four-arg wrapper keeps existing
-- callers and stores NULL when the provider did not report a cache count.
CREATE FUNCTION vc.settle_model_usage_reservation(
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
           cached_input_tokens = p_cached,
           actual_usd = v_actual,
           settled_at = clock_timestamp()
     WHERE id = v_row.id;
    RETURN QUERY SELECT v_row.id, v_row.purpose, 'SETTLED'::text,
        to_char(v_actual, 'FM999999999999990.000000'), p_input, p_output, p_cached, false;
END;
$$;

CREATE OR REPLACE FUNCTION vc.settle_model_usage_reservation(
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
BEGIN
    RETURN QUERY
    SELECT s.out_reservation_id, s.out_purpose, s.out_status, s.out_actual_usd,
           s.out_input_tokens, s.out_output_tokens, s.out_idempotent
      FROM vc.settle_model_usage_reservation(p_owner, p_reservation_id, p_input, p_output, NULL::bigint) s;
END;
$$;

CREATE FUNCTION vc.settle_model_cost(
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
    PERFORM 1 FROM vc.month_cost_budget
     WHERE month_start = v_reservation.month_start FOR UPDATE;
    v_actual := round((p_actual_input_tokens * v_reservation.input_usd_per_1k
                     + p_actual_output_tokens * v_reservation.output_usd_per_1k) / 1000, 6);
    UPDATE vc.month_cost_budget
       SET reserved_usd = greatest(0, reserved_usd - v_reservation.reserved_usd),
           settled_usd = settled_usd + v_actual
     WHERE month_start = v_reservation.month_start;
    UPDATE vc.model_cost_reservation
       SET status = 'SETTLED',
           actual_input_tokens = p_actual_input_tokens,
           actual_output_tokens = p_actual_output_tokens,
           cached_input_tokens = p_cached,
           actual_usd = v_actual,
           settled_at = clock_timestamp()
     WHERE id = v_reservation.id;
    RETURN QUERY SELECT v_actual, true;
END;
$$;

CREATE OR REPLACE FUNCTION vc.settle_model_cost(
    p_provider_attempt_id text,
    p_actual_input_tokens bigint,
    p_actual_output_tokens bigint)
    RETURNS TABLE(out_actual_usd numeric, out_changed boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT s.out_actual_usd, s.out_changed
      FROM vc.settle_model_cost(
          p_provider_attempt_id, p_actual_input_tokens, p_actual_output_tokens, NULL::bigint) s;
END;
$$;

CREATE FUNCTION vc.go_settle_held_model_cost(
    p_attempt text, p_disposition text, p_input bigint, p_output bigint, p_cached bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
    v_actual numeric(18,6);
BEGIN
    SELECT * INTO v_row FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_attempt FOR UPDATE;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_row.status <> 'HELD' THEN
        IF v_row.actual_usd IS NULL THEN
            RETURN NULL;
        END IF;
        RETURN round(v_row.actual_usd * 1000000)::bigint;
    END IF;
    IF p_disposition = 'NOT_SENT' THEN
        PERFORM vc.release_model_cost(p_attempt);
        RETURN 0;
    END IF;
    IF p_disposition = 'USAGE_REPORTED' AND p_input IS NOT NULL AND p_output IS NOT NULL THEN
        SELECT out_actual_usd INTO v_actual
          FROM vc.settle_model_cost(p_attempt, p_input, p_output, p_cached);
        IF v_actual IS NULL THEN
            RETURN NULL;
        END IF;
        RETURN round(v_actual * 1000000)::bigint;
    END IF;
    PERFORM vc.mark_model_cost_unknown(p_attempt);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_settle_held_model_cost(
    p_attempt text, p_disposition text, p_input bigint, p_output bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN vc.go_settle_held_model_cost(p_attempt, p_disposition, p_input, p_output, NULL::bigint);
END;
$$;

CREATE FUNCTION vc.settle_follow_up_model_call(
    p_owner bigint,
    p_attempt text,
    p_disposition text,
    p_input bigint,
    p_output bigint,
    p_cached bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_disposition IS NULL OR p_disposition NOT IN ('NOT_SENT', 'USAGE_REPORTED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'follow_up: cost disposition is not allowed';
    END IF;
    RETURN vc.go_settle_held_model_cost(p_attempt, p_disposition, p_input, p_output, p_cached);
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_settle_attempt_cost_trigger()
RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE v_actual bigint; v_attempt text;
BEGIN
    IF OLD.status = 'CREATED' AND NEW.status <> 'CREATED' THEN
        IF TG_TABLE_NAME = 'attempt_intent' THEN
            v_actual := vc.go_settle_held_model_cost(NEW.provider_attempt_id,
                NEW.billing_disposition, NEW.input_tokens, NEW.output_tokens, NULL);
            IF v_actual IS NOT NULL THEN NEW.actual_cost := v_actual; END IF;
        ELSE
            PERFORM vc.go_settle_held_model_cost('memory-extract:' || NEW.id::text,
                NEW.billing_disposition, NEW.input_tokens, NEW.output_tokens, NEW.cached_input_tokens);
            FOR v_attempt IN
                SELECT provider_attempt_id FROM vc.model_cost_reservation
                 WHERE status = 'HELD'
                   AND provider_attempt_id LIKE 'memory-extract:' || NEW.id::text || ':%'
            LOOP
                PERFORM vc.go_settle_held_model_cost(v_attempt,
                    NEW.billing_disposition, NEW.input_tokens, NEW.output_tokens, NEW.cached_input_tokens);
            END LOOP;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP FUNCTION vc.go_record_memory_extract_outcome(bigint, bigint, bigint, text, bigint, bigint, text, text);

CREATE FUNCTION vc.go_record_memory_extract_outcome(
    p_owner_user_id  bigint,
    p_work_item_id   bigint,
    p_attempt_id     bigint,
    p_status         text,
    p_input_tokens   bigint,
    p_output_tokens  bigint,
    p_failure_code   text,
    p_output_payload text,
    p_cached         bigint DEFAULT NULL)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_work_item_id IS NULL OR p_work_item_id <= 0
       OR p_attempt_id IS NULL OR p_attempt_id <= 0
       OR (p_cached IS NOT NULL AND p_cached < 0) THEN
        RAISE EXCEPTION 'go_record_memory_extract_outcome: owner, work item and attempt are required';
    END IF;
    IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED') THEN
        RAISE EXCEPTION 'go_record_memory_extract_outcome: unsupported outcome status %', p_status;
    END IF;
    PERFORM vc.go_assert_owner(p_owner_user_id);

    UPDATE vc.memory_extract_attempt a
       SET status = p_status,
           billing_disposition = CASE
               WHEN p_input_tokens IS NULL OR p_output_tokens IS NULL THEN 'UNKNOWN'
               ELSE 'USAGE_REPORTED'
           END,
           input_tokens = p_input_tokens,
           output_tokens = p_output_tokens,
           cached_input_tokens = p_cached,
           failure_code = p_failure_code,
           output_payload = p_output_payload,
           terminal_at = clock_timestamp()
     WHERE a.owner_user_id = p_owner_user_id
       AND a.id = p_attempt_id
       AND a.work_item_id = p_work_item_id
       AND a.status = 'CREATED';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

DROP FUNCTION vc.admin_model_usage_summary(bigint, timestamptz);

CREATE FUNCTION vc.admin_model_usage_summary(
    p_acting_account_id bigint,
    p_since timestamptz DEFAULT now() - interval '14 days',
    p_until timestamptz DEFAULT NULL)
    RETURNS TABLE(
        out_purpose text,
        out_calls bigint,
        out_actual_usd text,
        out_estimated_usd text,
        out_unsettled_usd text,
        out_input_tokens bigint,
        out_output_tokens bigint,
        out_unpriced_calls bigint,
        out_cached_input_tokens bigint,
        out_includes_unpriced boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_model_usage_summary: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_model_usage_summary: caller is not an active ADMIN';
    END IF;
    RETURN QUERY
    WITH bounds AS (
        SELECT COALESCE(p_since, now() - interval '14 days') AS since,
               p_until AS until_at
    ),
    res AS (
        SELECT r.purpose,
               count(*) FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN'))::bigint AS calls,
               count(*) FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN')
                                  AND r.price_version IS NULL)::bigint AS unpriced_calls,
               sum(r.actual_usd) FILTER (WHERE r.status = 'SETTLED' AND r.price_version IS NOT NULL) AS actual_usd,
               sum(r.reserved_usd) FILTER (WHERE r.status = 'HELD' AND r.price_version IS NOT NULL) AS estimated_usd,
               sum(r.reserved_usd) FILTER (WHERE r.status = 'UNKNOWN' AND r.price_version IS NOT NULL) AS unsettled_usd,
               COALESCE(sum(COALESCE(r.actual_input_tokens, r.estimated_input_tokens))
                        FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN')), 0)::bigint AS input_tokens,
               COALESCE(sum(COALESCE(r.actual_output_tokens, r.estimated_output_tokens))
                        FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN')), 0)::bigint AS output_tokens,
               sum(r.cached_input_tokens) FILTER (
                   WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN')
                     AND r.cached_input_tokens IS NOT NULL) AS cached_tokens
          FROM vc.model_cost_reservation r
          CROSS JOIN bounds b
         WHERE r.created_at >= b.since
           AND (b.until_at IS NULL OR r.created_at < b.until_at)
         GROUP BY r.purpose
    ),
    legacy AS (
        SELECT count(*)::bigint AS calls,
               sum(u.actual_cost) AS actual_usd,
               COALESCE(sum(u.input_tokens), 0)::bigint AS input_tokens,
               COALESCE(sum(u.output_tokens), 0)::bigint AS output_tokens
          FROM vc.generation_usage u
          CROSS JOIN bounds b
         WHERE u.recorded_at >= b.since
           AND (b.until_at IS NULL OR u.recorded_at < b.until_at)
           AND NOT EXISTS (
               SELECT 1 FROM vc.model_cost_reservation r
                WHERE r.provider_attempt_id = u.provider_ref)
           AND NOT EXISTS (
               SELECT 1 FROM vc.attempt_intent a
               JOIN vc.model_cost_reservation r
                 ON r.provider_attempt_id = a.provider_attempt_id
                WHERE a.owner_user_id = u.owner_user_id
                  AND a.generation_id = u.generation_id)
    ),
    emb AS (
        SELECT count(*)::bigint AS calls
          FROM vc.local_embedding_call e
          CROSS JOIN bounds b
         WHERE e.recorded_at >= b.since
           AND (b.until_at IS NULL OR e.recorded_at < b.until_at)
    ),
    purposes(purpose, ord) AS (
        VALUES
            ('FOREGROUND_CHAT'::text, 1),
            ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 2),
            ('BACKGROUND_GREETINGS', 3),
            ('TOOL_TURN', 4),
            ('LEGACY_CHAT', 5),
            ('LEGACY_GENERATION', 6),
            ('EMBEDDING', 7)
    )
    SELECT p.purpose,
           CASE p.purpose
               WHEN 'LEGACY_GENERATION' THEN COALESCE(l.calls, 0)
               WHEN 'EMBEDDING' THEN COALESCE(e.calls, 0)
               ELSE COALESCE(r.calls, 0)
           END,
           CASE
               WHEN p.purpose = 'EMBEDDING' THEN NULL::text
               WHEN p.purpose = 'LEGACY_GENERATION' THEN
                   CASE WHEN COALESCE(l.calls, 0) = 0 THEN NULL
                        ELSE to_char(l.actual_usd, 'FM999999999999990.000000') END
               ELSE CASE WHEN r.actual_usd IS NULL THEN NULL
                         ELSE to_char(r.actual_usd, 'FM999999999999990.000000') END
           END,
           CASE
               WHEN p.purpose IN ('EMBEDDING', 'LEGACY_GENERATION') THEN NULL::text
               WHEN r.estimated_usd IS NULL THEN NULL
               ELSE to_char(r.estimated_usd, 'FM999999999999990.000000')
           END,
           CASE
               WHEN p.purpose IN ('EMBEDDING', 'LEGACY_GENERATION') THEN NULL::text
               WHEN r.unsettled_usd IS NULL THEN NULL
               ELSE to_char(r.unsettled_usd, 'FM999999999999990.000000')
           END,
           CASE p.purpose
               WHEN 'LEGACY_GENERATION' THEN COALESCE(l.input_tokens, 0)
               WHEN 'EMBEDDING' THEN 0::bigint
               ELSE COALESCE(r.input_tokens, 0)
           END,
           CASE p.purpose
               WHEN 'LEGACY_GENERATION' THEN COALESCE(l.output_tokens, 0)
               WHEN 'EMBEDDING' THEN 0::bigint
               ELSE COALESCE(r.output_tokens, 0)
           END,
           CASE
               WHEN p.purpose IN ('EMBEDDING', 'LEGACY_GENERATION') THEN 0::bigint
               ELSE COALESCE(r.unpriced_calls, 0)
           END,
           CASE
               WHEN p.purpose IN ('EMBEDDING', 'LEGACY_GENERATION') THEN NULL::bigint
               ELSE r.cached_tokens::bigint
           END,
           CASE
               WHEN p.purpose IN ('EMBEDDING', 'LEGACY_GENERATION') THEN false
               ELSE COALESCE(r.unpriced_calls, 0) > 0
           END
      FROM purposes p
      LEFT JOIN res r ON r.purpose = p.purpose
      LEFT JOIN legacy l ON p.purpose = 'LEGACY_GENERATION'
      LEFT JOIN emb e ON p.purpose = 'EMBEDDING'
     ORDER BY p.ord;
END;
$$;

REVOKE ALL ON FUNCTION vc.insert_model_usage_hold(
    bigint, bigint, text, text, text, text, bigint, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.insert_model_usage_hold(
    bigint, bigint, text, text, text, text, bigint, bigint, bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.settle_model_usage_reservation(bigint, bigint, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.settle_model_usage_reservation(bigint, bigint, bigint, bigint, bigint) TO vc_api;

REVOKE ALL ON FUNCTION vc.settle_model_cost(text, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.settle_model_cost(text, bigint, bigint, bigint)
    TO vc_api, vc_worker, vc_job_coordinator;

REVOKE ALL ON FUNCTION vc.go_settle_held_model_cost(text, text, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_settle_held_model_cost(text, text, bigint, bigint, bigint)
    TO vc_api, vc_worker, vc_job_coordinator;

REVOKE ALL ON FUNCTION vc.settle_follow_up_model_call(bigint, text, text, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.settle_follow_up_model_call(bigint, text, text, bigint, bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_record_memory_extract_outcome(
    bigint, bigint, bigint, text, bigint, bigint, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_record_memory_extract_outcome(
    bigint, bigint, bigint, text, bigint, bigint, text, text, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.admin_model_usage_summary(bigint, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.admin_model_usage_summary(bigint, timestamptz, timestamptz) TO vc_api;

-- The V105 reservation entry is still executable. A missing price inserts one
-- unpriced hold and does not move the month pool. A configured price keeps
-- the caller-supplied cap.
CREATE OR REPLACE FUNCTION vc.reserve_model_cost(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_provider_attempt_id text,
    p_provider_id text,
    p_model_id text,
    p_estimated_input_tokens bigint,
    p_estimated_output_tokens bigint,
    p_monthly_cap_usd numeric
)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_reserved_usd numeric,
        out_threshold text,
        out_inserted boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_month date := date_trunc('month', now())::date;
    v_price vc.model_unit_price%ROWTYPE;
    v_existing vc.model_cost_reservation%ROWTYPE;
    v_hold numeric(18,6);
    v_spend numeric;
    v_ratio numeric;
    v_threshold text;
    v_id bigint;
BEGIN
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'reserve_model_cost: owner mismatch';
    END IF;
    IF p_work_item_id IS NULL OR p_work_item_id <= 0
       OR p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = ''
       OR p_provider_id IS NULL OR btrim(p_provider_id) = ''
       OR p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_estimated_input_tokens IS NULL OR p_estimated_input_tokens < 0
       OR p_estimated_output_tokens IS NULL OR p_estimated_output_tokens < 0
       OR p_monthly_cap_usd IS NULL OR p_monthly_cap_usd <= 0 THEN
        RAISE EXCEPTION 'reserve_model_cost: invalid reservation request';
    END IF;

    SELECT p.* INTO v_price FROM vc.model_unit_price p
     WHERE p.provider_id = p_provider_id AND p.model_id = p_model_id
       AND p.active AND p.effective_from <= now()
     ORDER BY p.price_version DESC LIMIT 1;
    IF v_price.provider_id IS NULL THEN
        INSERT INTO vc.model_cost_reservation(
            owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
            price_version, month_start, estimated_input_tokens, estimated_output_tokens,
            input_usd_per_1k, output_usd_per_1k, reserved_usd)
        VALUES (
            p_owner_user_id, p_work_item_id, p_provider_attempt_id, p_provider_id, p_model_id,
            NULL, v_month, p_estimated_input_tokens, p_estimated_output_tokens,
            NULL, NULL, 0)
        RETURNING id INTO v_id;
        RETURN QUERY SELECT v_id, 0::numeric, 'NONE'::text, true;
        RETURN;
    END IF;

    INSERT INTO vc.month_cost_budget(month_start) VALUES (v_month)
    ON CONFLICT (month_start) DO NOTHING;
    SELECT * INTO STRICT v_spend FROM (
        SELECT settled_usd + reserved_usd AS spend
          FROM vc.month_cost_budget WHERE month_start = v_month FOR UPDATE) q;

    SELECT * INTO v_existing FROM vc.model_cost_reservation r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.work_item_id = p_work_item_id AND r.status = 'HELD'
     FOR UPDATE;
    IF v_existing.id IS NOT NULL THEN
        IF v_existing.provider_id = p_provider_id AND v_existing.model_id = p_model_id THEN
            UPDATE vc.model_cost_reservation
               SET provider_attempt_id = p_provider_attempt_id
             WHERE id = v_existing.id;
            v_ratio := CASE WHEN p_monthly_cap_usd = 0 THEN 0
                            ELSE (v_spend / p_monthly_cap_usd) * 100 END;
            v_threshold := CASE WHEN v_ratio >= 100 THEN 'BUDGET_100'
                                WHEN v_ratio >= 95 THEN 'BUDGET_95'
                                WHEN v_ratio >= 80 THEN 'BUDGET_80'
                                ELSE 'NONE' END;
            RETURN QUERY SELECT v_existing.id, v_existing.reserved_usd,
                                v_threshold, false;
            RETURN;
        END IF;
        UPDATE vc.month_cost_budget
           SET reserved_usd = greatest(0, reserved_usd - v_existing.reserved_usd)
         WHERE month_start = v_month;
        UPDATE vc.model_cost_reservation
           SET status = 'RELEASED', released_at = now()
         WHERE id = v_existing.id;
        v_spend := greatest(0, v_spend - v_existing.reserved_usd);
    END IF;

    v_hold := round((p_estimated_input_tokens * v_price.input_usd_per_1k
                   + p_estimated_output_tokens * v_price.output_usd_per_1k) / 1000, 6);
    IF v_spend + v_hold > p_monthly_cap_usd THEN
        RAISE EXCEPTION 'reserve_model_cost: monthly cap exceeded';
    END IF;
    UPDATE vc.month_cost_budget SET reserved_usd = reserved_usd + v_hold
     WHERE month_start = v_month;
    INSERT INTO vc.model_cost_reservation(
        owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
        price_version, month_start, estimated_input_tokens, estimated_output_tokens,
        input_usd_per_1k, output_usd_per_1k, reserved_usd)
    VALUES (p_owner_user_id, p_work_item_id, p_provider_attempt_id,
            p_provider_id, p_model_id, v_price.price_version, v_month,
            p_estimated_input_tokens, p_estimated_output_tokens,
            v_price.input_usd_per_1k, v_price.output_usd_per_1k, v_hold)
    RETURNING id INTO v_id;
    v_ratio := ((v_spend + v_hold) / p_monthly_cap_usd) * 100;
    v_threshold := CASE WHEN v_ratio >= 100 THEN 'BUDGET_100'
                        WHEN v_ratio >= 95 THEN 'BUDGET_95'
                        WHEN v_ratio >= 80 THEN 'BUDGET_80'
                        ELSE 'NONE' END;
    RETURN QUERY SELECT v_id, v_hold, v_threshold, true;
END;
$$;
