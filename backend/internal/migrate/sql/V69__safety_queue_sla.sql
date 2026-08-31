-- METRICS-ALERT V69: R3/R4 SLA visibility on the admin safety queue.
--
-- Redefines vc.list_safety_events (V59) to also return the event age in
-- hours. The runtime computes the slaBreached flag from deployment-configured
-- thresholds (virtual-companion.alerts.r3-sla-hours / r4-sla-hours), so the
-- SQL stays threshold-free and only reports the observable fact: how old the
-- queued row is. Signature, ADMIN re-verification, keyset shape and grants
-- are unchanged from V59.

SET search_path TO vc, pg_catalog;

-- PostgreSQL forbids CREATE OR REPLACE across a changed OUT row type
-- (same V44 lesson): drop the V59 signature first, then recreate with the
-- extra out_age_hours column and re-tighten grants below.
DROP FUNCTION IF EXISTS vc.list_safety_events(bigint, bigint, int);

CREATE OR REPLACE FUNCTION vc.list_safety_events(
    p_acting_account_id bigint,
    p_after             bigint DEFAULT NULL,
    p_limit             int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_generation_id bigint,
                  out_stage text, out_risk_level text, out_rule_id text,
                  out_created_at timestamptz, out_age_hours numeric)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'list_safety_events: acting account is required';
    END IF;
    -- SECURITY DEFINER crosses owner isolation on purpose; only an ACTIVE
    -- ADMIN may execute (re-verified here, never trusted from the caller).
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'list_safety_events: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT e.id, e.owner_user_id, e.generation_id, e.stage, e.risk_level,
           e.rule_id, e.created_at,
           round(extract(epoch FROM (now() - e.created_at)) / 3600.0, 1)
      FROM vc.safety_event e
     WHERE (p_after IS NULL OR e.id < p_after)
     ORDER BY e.id DESC
     LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.list_safety_events(bigint, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_safety_events(bigint, bigint, int) TO vc_api;
