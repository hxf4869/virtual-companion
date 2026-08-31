-- S0-29: versioned provider/model prices and atomic monthly cost holds.
-- This is provider-cost protection only: no order, payment or user charge.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.model_unit_price DROP CONSTRAINT model_unit_price_pkey;
ALTER TABLE vc.model_unit_price
    ADD COLUMN model_id text NOT NULL DEFAULT '*',
    ADD COLUMN active boolean NOT NULL DEFAULT true,
    ADD CONSTRAINT model_unit_price_pk
        PRIMARY KEY (provider_id, model_id, price_version),
    ADD CONSTRAINT model_unit_price_model CHECK (btrim(model_id) <> '');

CREATE TABLE vc.model_cost_reservation (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint,
    work_item_id bigint NOT NULL,
    provider_attempt_id text NOT NULL UNIQUE,
    provider_id text NOT NULL,
    model_id text NOT NULL,
    price_version integer NOT NULL,
    month_start date NOT NULL,
    estimated_input_tokens bigint NOT NULL CHECK (estimated_input_tokens >= 0),
    estimated_output_tokens bigint NOT NULL CHECK (estimated_output_tokens >= 0),
    input_usd_per_1k numeric NOT NULL CHECK (input_usd_per_1k >= 0),
    output_usd_per_1k numeric NOT NULL CHECK (output_usd_per_1k >= 0),
    reserved_usd numeric(18,6) NOT NULL CHECK (reserved_usd >= 0),
    actual_input_tokens bigint,
    actual_output_tokens bigint,
    actual_usd numeric(18,6),
    status text NOT NULL DEFAULT 'HELD',
    created_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz,
    released_at timestamptz,
    CONSTRAINT model_cost_reservation_status CHECK (
        status IN ('HELD', 'SETTLED', 'RELEASED')),
    CONSTRAINT model_cost_reservation_terminal_shape CHECK (
        (status = 'HELD' AND settled_at IS NULL AND released_at IS NULL
            AND actual_usd IS NULL)
        OR (status = 'SETTLED' AND settled_at IS NOT NULL AND released_at IS NULL
            AND actual_usd IS NOT NULL)
        OR (status = 'RELEASED' AND released_at IS NOT NULL AND settled_at IS NULL
            AND actual_usd IS NULL))
);
CREATE UNIQUE INDEX model_cost_one_active_work_item
    ON vc.model_cost_reservation(owner_user_id, work_item_id)
    WHERE status = 'HELD';

CREATE FUNCTION vc.scrub_model_cost_on_account_deletion()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE v_reservation vc.model_cost_reservation%ROWTYPE;
BEGIN
    FOR v_reservation IN
        SELECT * FROM vc.model_cost_reservation
         WHERE owner_user_id = NEW.account_id AND status = 'HELD'
         FOR UPDATE
    LOOP
        PERFORM 1 FROM vc.month_cost_budget
         WHERE month_start = v_reservation.month_start FOR UPDATE;
        UPDATE vc.month_cost_budget
           SET reserved_usd = greatest(0, reserved_usd - v_reservation.reserved_usd)
         WHERE month_start = v_reservation.month_start;
        UPDATE vc.model_cost_reservation
           SET status = 'RELEASED', released_at = now(), owner_user_id = NULL
         WHERE id = v_reservation.id;
    END LOOP;
    UPDATE vc.model_cost_reservation SET owner_user_id = NULL
     WHERE owner_user_id = NEW.account_id AND status <> 'HELD';
    RETURN NEW;
END;
$$;

CREATE TRIGGER account_deletion_scrub_model_cost
AFTER INSERT OR UPDATE OF status ON vc.account_deletion_intent
FOR EACH ROW EXECUTE FUNCTION vc.scrub_model_cost_on_account_deletion();

-- Reconcile any tombstones that predate this migration.
UPDATE vc.account_deletion_intent SET status = status;

REVOKE ALL ON FUNCTION vc.scrub_model_cost_on_account_deletion() FROM PUBLIC;

REVOKE ALL ON vc.model_unit_price, vc.month_cost_budget,
    vc.model_cost_reservation FROM PUBLIC;
REVOKE SELECT ON vc.model_unit_price, vc.month_cost_budget
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE OR REPLACE FUNCTION vc.model_unit_price_present()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT EXISTS (SELECT 1 FROM vc.model_unit_price p
                    WHERE p.active AND p.effective_from <= now())
$$;

CREATE OR REPLACE FUNCTION vc.month_cost_spend()
    RETURNS numeric
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT COALESCE(b.settled_usd, 0) + COALESCE(b.reserved_usd, 0)
      FROM (SELECT date_trunc('month', now())::date AS month_start) m
      LEFT JOIN vc.month_cost_budget b USING (month_start)
$$;

CREATE FUNCTION vc.reserve_model_cost(
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
        RAISE EXCEPTION 'reserve_model_cost: current unit price is unknown';
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

CREATE FUNCTION vc.settle_model_cost(
    p_provider_attempt_id text,
    p_actual_input_tokens bigint,
    p_actual_output_tokens bigint
)
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
       OR p_actual_output_tokens IS NULL OR p_actual_output_tokens < 0 THEN
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
    PERFORM 1 FROM vc.month_cost_budget
     WHERE month_start = v_reservation.month_start FOR UPDATE;
    v_actual := round((p_actual_input_tokens * v_reservation.input_usd_per_1k
                     + p_actual_output_tokens * v_reservation.output_usd_per_1k) / 1000, 6);
    UPDATE vc.month_cost_budget
       SET reserved_usd = greatest(0, reserved_usd - v_reservation.reserved_usd),
           settled_usd = settled_usd + v_actual
     WHERE month_start = v_reservation.month_start;
    UPDATE vc.model_cost_reservation
       SET status = 'SETTLED', actual_input_tokens = p_actual_input_tokens,
           actual_output_tokens = p_actual_output_tokens,
           actual_usd = v_actual, settled_at = now()
     WHERE id = v_reservation.id;
    RETURN QUERY SELECT v_actual, true;
END;
$$;

CREATE FUNCTION vc.release_model_cost(p_provider_attempt_id text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_reservation vc.model_cost_reservation%ROWTYPE;
BEGIN
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = '' THEN
        RAISE EXCEPTION 'release_model_cost: attempt id is required';
    END IF;
    SELECT * INTO v_reservation FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_provider_attempt_id FOR UPDATE;
    IF v_reservation.id IS NULL OR v_reservation.status <> 'HELD' THEN
        RETURN FALSE;
    END IF;
    PERFORM 1 FROM vc.month_cost_budget
     WHERE month_start = v_reservation.month_start FOR UPDATE;
    UPDATE vc.month_cost_budget
       SET reserved_usd = greatest(0, reserved_usd - v_reservation.reserved_usd)
     WHERE month_start = v_reservation.month_start;
    UPDATE vc.model_cost_reservation
       SET status = 'RELEASED', released_at = now()
     WHERE id = v_reservation.id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.model_cost_budget_snapshot()
    RETURNS TABLE(
        out_month_start date,
        out_reserved_usd numeric,
        out_settled_usd numeric,
        out_total_usd numeric)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT b.month_start, b.reserved_usd, b.settled_usd,
           b.reserved_usd + b.settled_usd
      FROM vc.month_cost_budget b
     WHERE b.month_start = date_trunc('month', now())::date
$$;

REVOKE ALL ON FUNCTION vc.reserve_model_cost(
    bigint, bigint, text, text, text, bigint, bigint, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.settle_model_cost(text, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.release_model_cost(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.model_cost_budget_snapshot() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.reserve_model_cost(
    bigint, bigint, text, text, text, bigint, bigint, numeric)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.settle_model_cost(text, bigint, bigint)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.release_model_cost(text)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.model_cost_budget_snapshot()
    TO vc_api, vc_worker, vc_job_coordinator;
