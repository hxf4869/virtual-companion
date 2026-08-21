-- B1-COST (§25.9 / §22.19): export settled per-day usage for reconciliation
-- with provider bills. generation_usage is FORCE ROW LEVEL SECURITY (V7 owner
-- isolation), so this CROSS-TENANT aggregate must run as a superuser or
-- BYPASSRLS role (e.g. postgres below); any other role — including the table
-- owner — is silently filtered to zero rows by RLS, and the guard at the
-- bottom refuses to emit an empty export in that case.
--   docker exec -i <container> psql -U postgres -d vc -T \
--     < infra/db/measure/export-usage.sql > usage.tsv
-- Output TSV: date, generations, input_tokens, output_tokens, settled_cost_usd
DO $$
DECLARE
    v_bypass boolean;
BEGIN
    SELECT rolsuper OR rolbypassrls INTO v_bypass
      FROM pg_roles WHERE rolname = current_user;
    IF NOT COALESCE(v_bypass, false) THEN
        RAISE EXCEPTION
            'export-usage: role % is subject to the FORCE RLS owner-isolation policy and would export zero rows; run as a superuser/BYPASSRLS role (see header)',
            current_user;
    END IF;
END $$;
SELECT to_char(u.day, 'YYYY-MM-DD')            AS date,
       count(*)                                AS generations,
       COALESCE(sum(u.input_tokens), 0)        AS input_tokens,
       COALESCE(sum(u.output_tokens), 0)       AS output_tokens,
       round(COALESCE(sum(u.actual_cost), 0)::numeric, 6) AS settled_cost_usd
  FROM (
       SELECT date_trunc('day', recorded_at) AS day, *
         FROM vc.generation_usage
       ) u
 GROUP BY u.day
 ORDER BY u.day;
