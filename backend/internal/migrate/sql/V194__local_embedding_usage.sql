-- W11-3: local embedding calls are a non-billed count. They do not write a
-- zero-dollar online cost and do not move month_cost_budget.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.local_embedding_call (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE vc.local_embedding_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.local_embedding_call FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.local_embedding_call FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.local_embedding_call FROM PUBLIC;

CREATE FUNCTION vc.record_local_embedding_call(p_owner bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    INSERT INTO vc.local_embedding_call(owner_user_id) VALUES (p_owner);
END;
$$;

CREATE OR REPLACE FUNCTION vc.admin_model_usage_summary(
    p_acting_account_id bigint,
    p_since timestamptz DEFAULT now() - interval '14 days')
    RETURNS TABLE(
        out_purpose text,
        out_calls bigint,
        out_actual_usd text,
        out_estimated_usd text,
        out_unsettled_usd text,
        out_input_tokens bigint,
        out_output_tokens bigint)
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
        SELECT COALESCE(p_since, now() - interval '14 days') AS since
    ),
    res AS (
        SELECT r.purpose,
               count(*) FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN'))::bigint AS calls,
               sum(r.actual_usd) FILTER (WHERE r.status = 'SETTLED') AS actual_usd,
               sum(r.reserved_usd) FILTER (WHERE r.status = 'HELD') AS estimated_usd,
               sum(r.reserved_usd) FILTER (WHERE r.status = 'UNKNOWN') AS unsettled_usd,
               COALESCE(sum(COALESCE(r.actual_input_tokens, r.estimated_input_tokens))
                        FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN')), 0)::bigint AS input_tokens,
               COALESCE(sum(COALESCE(r.actual_output_tokens, r.estimated_output_tokens))
                        FILTER (WHERE r.status IN ('HELD', 'SETTLED', 'UNKNOWN')), 0)::bigint AS output_tokens
          FROM vc.model_cost_reservation r
          CROSS JOIN bounds b
         WHERE r.created_at >= b.since
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
           END
      FROM purposes p
      LEFT JOIN res r ON r.purpose = p.purpose
      LEFT JOIN legacy l ON p.purpose = 'LEGACY_GENERATION'
      LEFT JOIN emb e ON p.purpose = 'EMBEDDING'
     ORDER BY p.ord;
END;
$$;

REVOKE ALL ON FUNCTION vc.record_local_embedding_call(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_local_embedding_call(bigint) TO vc_api;
