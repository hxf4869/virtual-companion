-- SAFETY-QUEUE V59: ADMIN-only read of the deterministic safety queue.
--
-- list_safety_events returns safety events across ALL owners, newest-first
-- keyset, re-verifying inside the SD that the acting account is an ACTIVE
-- ADMIN (the V36 identity_auth_event_list pattern — the runtime role check
-- is only a convenience; SQL is the authority). R34 keeps the queue
-- read-only: triage/disposition stays a human action outside the API (the
-- resolution columns from V58 are not writable here).
--
-- NL-EXIT (§21.3.4) needs no schema: an exit-intent turn reuses the existing
-- V10 cancel_generation (CREATED is cancellable) so the durable chat.cancelled
-- event is the auditable exit record.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.list_safety_events(
    p_acting_account_id bigint,
    p_after             bigint DEFAULT NULL,
    p_limit             int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_generation_id bigint,
                  out_stage text, out_risk_level text, out_rule_id text,
                  out_created_at timestamptz)
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
           e.rule_id, e.created_at
      FROM vc.safety_event e
     WHERE (p_after IS NULL OR e.id < p_after)
     ORDER BY e.id DESC
     LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.list_safety_events(bigint, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_safety_events(bigint, bigint, int) TO vc_api;
