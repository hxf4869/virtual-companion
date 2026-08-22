-- S0-29: versioned model unit prices + monthly cost hold.
-- An empty price table is the Technical Alpha default: when the monthly cap
-- is enabled the application fail-closes on unknown price. Currency billing
-- and user charges are out of scope.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.model_unit_price (
    provider_id         text PRIMARY KEY,
    price_version       int NOT NULL CHECK (price_version >= 1),
    input_usd_per_1k    numeric NOT NULL CHECK (input_usd_per_1k >= 0),
    output_usd_per_1k   numeric NOT NULL CHECK (output_usd_per_1k >= 0),
    effective_from      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vc.month_cost_budget (
    month_start  date PRIMARY KEY,
    reserved_usd numeric NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
    settled_usd  numeric NOT NULL DEFAULT 0 CHECK (settled_usd >= 0)
);

REVOKE ALL ON vc.model_unit_price FROM PUBLIC;
REVOKE ALL ON vc.month_cost_budget FROM PUBLIC;
GRANT SELECT ON vc.model_unit_price, vc.month_cost_budget
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.model_unit_price_present()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT EXISTS (SELECT 1 FROM vc.model_unit_price);
$$;

CREATE FUNCTION vc.month_cost_spend()
    RETURNS numeric
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_settled numeric;
    v_reserved numeric;
BEGIN
    SELECT COALESCE(sum(actual_cost), 0) INTO v_settled
      FROM vc.generation_usage
     WHERE recorded_at >= date_trunc('month', now());
    SELECT COALESCE(reserved_usd, 0) INTO v_reserved
      FROM vc.month_cost_budget
     WHERE month_start = date_trunc('month', now())::date;
    RETURN v_settled + COALESCE(v_reserved, 0);
END;
$$;

REVOKE ALL ON FUNCTION vc.model_unit_price_present() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.month_cost_spend() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.model_unit_price_present() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.month_cost_spend() TO vc_api;
