-- DOGFOOD-STABILIZATION V111: activation probe for retention categories.
--
-- The retention scheduler must distinguish "category has no ACTIVE policy
-- row (DRAFT — skip without alerting)" from "activated category whose policy
-- read failed (fail-closed P1)". The policy table is REVOKE ALL for runtime
-- roles, so the probe is a SECURITY DEFINER function granted to vc_api.
--
-- Returns true only when the category currently has at least one row with
-- active AND status='ACTIVE' (the V104 activation shape). A blank category
-- RAISEs; an unknown (non-CHECK) category name returns false — the caller
-- treats it as not activated.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.retention_category_active(p_category text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_category IS NULL OR btrim(p_category) = '' THEN
        RAISE EXCEPTION 'retention_category_active: category is required';
    END IF;
    RETURN EXISTS (SELECT 1 FROM vc.data_retention_policy
                    WHERE category = p_category AND active AND status = 'ACTIVE');
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.retention_category_active(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_category_active(text) TO vc_api;
