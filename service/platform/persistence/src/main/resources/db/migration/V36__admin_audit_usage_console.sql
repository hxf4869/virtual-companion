-- ADMIN-OPS V36: minimal internal admin console reads — audit event list and
-- per-day usage/cost summary (B0-005 最小内部管理台 slice, Alpha keeps to a
-- minimal internal page per FR-ADMIN 阶段边界).
--
-- Both functions follow the V31 ADMIN-only SECURITY DEFINER pattern (the
-- acting account must be an ACTIVE ADMIN, re-verified in SQL — the API layer's
-- role claim alone is never trusted):
--   * identity_auth_event_list — keyset-paginated read of the append-only
--     identity_auth_event audit trail (newest first; after = last id seen,
--     exclusive; limit clamped to a safe band).
--   * admin_usage_summary — per-day aggregates over vc.generation_usage
--     (generation count, settled input/output tokens, actual cost) since a
--     caller-supplied floor, newest day first. ZERO_LLM turns settle usage
--     with 0 tokens and 0 cost, so the summary reflects real spend only.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- identity_auth_event_list: ADMIN-only keyset read of the audit trail.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_auth_event_list(
    p_acting_account_id bigint,
    p_after             bigint DEFAULT NULL,
    p_limit             int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_event_type text, out_account_id bigint,
                  out_username text, out_occurred_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_auth_event_list: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_auth_event_list: caller is not an active ADMIN';
    END IF;
    RETURN QUERY
        SELECT e.id, e.event_type, e.account_id, e.username, e.occurred_at
          FROM vc.identity_auth_event e
         WHERE p_after IS NULL OR e.id < p_after
         ORDER BY e.id DESC
         LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_usage_summary: ADMIN-only per-day usage/cost aggregates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_usage_summary(
    p_acting_account_id bigint,
    p_since             timestamptz DEFAULT now() - interval '14 days'
)
    RETURNS TABLE(out_day date, out_generations bigint, out_input_tokens bigint,
                  out_output_tokens bigint, out_cost numeric)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_usage_summary: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_usage_summary: caller is not an active ADMIN';
    END IF;
    RETURN QUERY
        SELECT (u.recorded_at AT TIME ZONE 'UTC')::date AS day,
               count(*)::bigint                        AS generations,
               COALESCE(sum(u.input_tokens), 0)::bigint  AS input_tokens,
               COALESCE(sum(u.output_tokens), 0)::bigint AS output_tokens,
               COALESCE(sum(u.actual_cost), 0)         AS cost
          FROM vc.generation_usage u
         WHERE u.recorded_at >= COALESCE(p_since, now() - interval '14 days')
         GROUP BY day
         ORDER BY day DESC;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: EXECUTE granted to vc_api alone, mirroring V31.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION vc.identity_auth_event_list(bigint, bigint, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_usage_summary(bigint, timestamptz) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.identity_auth_event_list(bigint, bigint, int),
                vc.admin_usage_summary(bigint, timestamptz)
    TO vc_api;
