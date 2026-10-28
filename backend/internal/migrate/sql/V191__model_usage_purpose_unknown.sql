-- W11-3: one monthly pool for every priced send. A reservation records its
-- purpose. Timeout or missing usage becomes UNKNOWN and stays in
-- unsettled_usd; it is not released and not booked as a zero actual.
-- A new upstream send uses a new attempt. A settled, released, or unknown
-- attempt is not a free second send.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.month_cost_budget
    ADD COLUMN unsettled_usd numeric NOT NULL DEFAULT 0,
    ADD CONSTRAINT month_cost_budget_unsettled_nonneg CHECK (unsettled_usd >= 0);

ALTER TABLE vc.model_cost_reservation
    ADD COLUMN purpose text,
    ADD COLUMN unknown_at timestamptz;

UPDATE vc.model_cost_reservation
   SET purpose = CASE
       WHEN provider_attempt_id LIKE 'memory-extract:%' THEN 'MEMORY_EXTRACTION_DEDUP_SUMMARY'
       WHEN provider_attempt_id LIKE 'follow-up:%' THEN 'BACKGROUND_GREETINGS'
       ELSE 'LEGACY_CHAT'
   END
 WHERE purpose IS NULL;

ALTER TABLE vc.model_cost_reservation
    ALTER COLUMN purpose SET NOT NULL,
    ALTER COLUMN purpose SET DEFAULT 'LEGACY_CHAT';

ALTER TABLE vc.model_cost_reservation
    DROP CONSTRAINT model_cost_reservation_status,
    DROP CONSTRAINT model_cost_reservation_terminal_shape;

ALTER TABLE vc.model_cost_reservation
    ADD CONSTRAINT model_cost_reservation_status CHECK (
        status IN ('HELD', 'SETTLED', 'RELEASED', 'UNKNOWN')),
    ADD CONSTRAINT model_cost_reservation_purpose CHECK (
        purpose IN (
            'FOREGROUND_CHAT',
            'MEMORY_EXTRACTION_DEDUP_SUMMARY',
            'BACKGROUND_GREETINGS',
            'TOOL_TURN',
            'LEGACY_CHAT')),
    ADD CONSTRAINT model_cost_reservation_terminal_shape CHECK (
        (status = 'HELD' AND settled_at IS NULL AND released_at IS NULL
            AND unknown_at IS NULL AND actual_usd IS NULL)
        OR (status = 'SETTLED' AND settled_at IS NOT NULL AND released_at IS NULL
            AND unknown_at IS NULL AND actual_usd IS NOT NULL)
        OR (status = 'RELEASED' AND released_at IS NOT NULL AND settled_at IS NULL
            AND unknown_at IS NULL AND actual_usd IS NULL)
        OR (status = 'UNKNOWN' AND unknown_at IS NOT NULL AND settled_at IS NULL
            AND released_at IS NULL AND actual_usd IS NULL AND reserved_usd > 0)),
    ADD CONSTRAINT model_cost_reservation_subject CHECK (
        (purpose IN ('FOREGROUND_CHAT', 'TOOL_TURN') AND work_item_id IS NULL)
        OR (purpose NOT IN ('FOREGROUND_CHAT', 'TOOL_TURN') AND work_item_id IS NOT NULL));

ALTER TABLE vc.model_cost_reservation
    ALTER COLUMN work_item_id DROP NOT NULL;

CREATE FUNCTION vc.mark_model_cost_unknown(p_attempt text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.model_cost_reservation%ROWTYPE;
BEGIN
    SELECT * INTO v_row FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_attempt FOR UPDATE;
    IF NOT FOUND OR v_row.status = 'UNKNOWN' OR v_row.status <> 'HELD' THEN
        RETURN;
    END IF;
    PERFORM 1 FROM vc.month_cost_budget
     WHERE month_start = v_row.month_start FOR UPDATE;
    UPDATE vc.month_cost_budget
       SET reserved_usd = reserved_usd - v_row.reserved_usd,
           unsettled_usd = unsettled_usd + v_row.reserved_usd
     WHERE month_start = v_row.month_start;
    UPDATE vc.model_cost_reservation
       SET status = 'UNKNOWN', unknown_at = clock_timestamp()
     WHERE id = v_row.id;
END;
$$;

-- 10-arg hold. The monetary ceiling is reserved in full. Spend is
-- settled + reserved + unsettled, so an unknown send still occupies the cap.
CREATE FUNCTION vc.go_hold_model_cost(
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
    v_hold := p_ceiling::numeric / 1000000;
    IF (p_input_tokens * v_price.input_usd_per_1k
        + p_output_tokens * v_price.output_usd_per_1k) / 1000 > v_hold THEN
        RAISE EXCEPTION 'model cost reservation ceiling is too small';
    END IF;
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

-- Existing callers keep the 9-arg signature. Purpose is inferred from the
-- attempt key so memory.go does not change.
CREATE OR REPLACE FUNCTION vc.go_hold_model_cost(
    p_owner bigint, p_job bigint, p_attempt text,
    p_provider text, p_model text, p_input_tokens bigint, p_output_tokens bigint,
    p_ceiling bigint, p_monthly_limit bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_purpose text;
BEGIN
    v_purpose := CASE
        WHEN p_attempt LIKE 'memory-extract:%' THEN 'MEMORY_EXTRACTION_DEDUP_SUMMARY'
        WHEN p_attempt LIKE 'follow-up:%' THEN 'BACKGROUND_GREETINGS'
        ELSE 'LEGACY_CHAT'
    END;
    PERFORM vc.go_hold_model_cost(
        p_owner, p_job, p_attempt, p_provider, p_model,
        p_input_tokens, p_output_tokens, p_ceiling, p_monthly_limit, v_purpose);
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_settle_held_model_cost(
    p_attempt text, p_disposition text, p_input bigint, p_output bigint)
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
        -- UNKNOWN has no actual. Do not report it as zero.
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
          FROM vc.settle_model_cost(p_attempt, p_input, p_output);
        RETURN round(v_actual * 1000000)::bigint;
    END IF;
    PERFORM vc.mark_model_cost_unknown(p_attempt);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION vc.month_cost_spend()
    RETURNS numeric
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT COALESCE(b.settled_usd, 0) + COALESCE(b.reserved_usd, 0) + COALESCE(b.unsettled_usd, 0)
      FROM (SELECT date_trunc('month', now())::date AS month_start) m
      LEFT JOIN vc.month_cost_budget b USING (month_start)
$$;

CREATE OR REPLACE FUNCTION vc.prepare_follow_up_model_call(
    p_owner bigint,
    p_job bigint,
    p_attempt text,
    p_provider text,
    p_model text,
    p_input bigint,
    p_output bigint,
    p_ceiling bigint,
    p_monthly bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_attempt IS NULL OR btrim(p_attempt) = '' OR p_job IS NULL OR p_job <= 0 THEN
        RAISE EXCEPTION 'follow_up: attempt is required';
    END IF;
    SELECT r.status INTO v_status
      FROM vc.model_cost_reservation r
     WHERE r.provider_attempt_id = p_attempt;
    IF FOUND THEN
        IF v_status = 'HELD' THEN
            RETURN 'REUSED_HELD';
        END IF;
        IF v_status = 'SETTLED' THEN
            RETURN 'REUSED_SETTLED';
        END IF;
        IF v_status = 'RELEASED' THEN
            RETURN 'REUSED_RELEASED';
        END IF;
        IF v_status = 'UNKNOWN' THEN
            RETURN 'REUSED_UNKNOWN';
        END IF;
        RETURN 'REUSED_SETTLED';
    END IF;
    BEGIN
        PERFORM vc.go_hold_model_cost(
            p_owner, p_job, p_attempt, p_provider, p_model, p_input, p_output, p_ceiling, p_monthly);
    EXCEPTION WHEN unique_violation THEN
        RETURN 'REUSED_HELD';
    END;
    RETURN 'HELD';
END;
$$;

REVOKE ALL ON FUNCTION
    vc.mark_model_cost_unknown(text),
    vc.go_hold_model_cost(bigint, bigint, text, text, text, bigint, bigint, bigint, bigint, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.go_hold_model_cost(bigint, bigint, text, text, text, bigint, bigint, bigint, bigint, text)
    TO vc_api, vc_worker;
