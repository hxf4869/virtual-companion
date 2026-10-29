-- The catalog price on provider_model.pricing is USD per million tokens.
-- vc.model_unit_price stays the reservation source of truth: USD per 1K
-- tokens, one row per price_version. Saving a provider model publishes or
-- retires that ledger in the same transaction. A missing side, an unknown
-- currency, or a non-USD currency is not a zero price.
--
-- The current price is the highest active version whose effective_from has
-- arrived. A new price inserts the next version and leaves older versions
-- active so an existing reservation keeps the price it copied. Retiring
-- marks every active row inactive; it does not delete them and does not
-- insert a higher inactive row, because the lookup filters active before
-- it orders by version. The same numeric price is not published again.
-- A provider that is DISABLED does not by itself retire a price; only the
-- enabled profiles of a model_id decide the published price.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.catalog_usd_per_1k(p_per_million numeric)
    RETURNS numeric
    LANGUAGE sql
    IMMUTABLE
    SET search_path = pg_catalog
AS $$
    SELECT CASE
               WHEN p_per_million IS NULL OR p_per_million < 0 THEN NULL
               ELSE NULLIF(
                        trim(trailing '.' FROM trim(trailing '0' FROM (p_per_million / 1000)::text)),
                        '')::numeric
           END
$$;

-- One enabled profile contributes a pair only when both sides are numbers
-- and the currency is exactly USD. The casts sit in THEN, after the type
-- check, so a non-numeric value is not coerced.
CREATE FUNCTION vc.catalog_profile_usd_per_1k(p_pricing jsonb, p_state text)
    RETURNS TABLE(in_1k numeric, out_1k numeric)
    LANGUAGE sql
    IMMUTABLE
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.catalog_usd_per_1k(
               CASE WHEN jsonb_typeof(p_pricing->'inputPerMillionTokens') = 'number'
                    THEN (p_pricing->>'inputPerMillionTokens')::numeric END),
           vc.catalog_usd_per_1k(
               CASE WHEN jsonb_typeof(p_pricing->'outputPerMillionTokens') = 'number'
                    THEN (p_pricing->>'outputPerMillionTokens')::numeric END)
     WHERE p_state = 'ENABLED'
       AND p_pricing->>'currency' = 'USD'
$$;

CREATE FUNCTION vc.profile_ledger_price_status(
    p_provider_id text,
    p_model_id text,
    p_state text,
    p_pricing jsonb)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT CASE
               WHEN p_pricing IS NOT NULL
                    AND jsonb_typeof(p_pricing->'currency') = 'string'
                    AND btrim(p_pricing->>'currency') <> ''
                    AND p_pricing->>'currency' <> 'USD'
                   THEN 'UNSUPPORTED_CURRENCY'
               WHEN EXISTS (
                   SELECT 1
                     FROM vc.catalog_profile_usd_per_1k(p_pricing, p_state) i
                     JOIN vc.model_unit_price p
                       ON p.provider_id = p_provider_id
                      AND p.model_id = p_model_id
                      AND p.active
                      AND p.effective_from <= clock_timestamp()
                      AND p.input_usd_per_1k = i.in_1k
                      AND p.output_usd_per_1k = i.out_1k
                      AND p.price_version = (
                          SELECT max(q.price_version)
                            FROM vc.model_unit_price q
                           WHERE q.provider_id = p_provider_id
                             AND q.model_id = p_model_id
                             AND q.active
                             AND q.effective_from <= clock_timestamp())
                    WHERE i.in_1k IS NOT NULL
                      AND i.out_1k IS NOT NULL)
                   THEN 'ACTIVE'
               ELSE 'MISSING'
           END
$$;

-- p_retire false only publishes a complete, unanimous USD price. It leaves
-- every other ledger row untouched, so a migration backfill cannot retire a
-- hand-written price. p_retire true also clears the active flag when the
-- enabled profiles of that model_id no longer support one USD price.
CREATE FUNCTION vc.sync_provider_model_ledger(p_provider_id text, p_retire boolean)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_provider text := btrim(p_provider_id);
    v_model text;
    v_enabled integer;
    v_priced integer;
    v_distinct integer;
    v_in numeric;
    v_out numeric;
    v_cur_in numeric;
    v_cur_out numeric;
    v_next integer;
BEGIN
    IF v_provider IS NULL OR v_provider = '' THEN
        RETURN;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('vc.provider_model.capacity'));
    FOR v_model IN
        SELECT DISTINCT x.model_id
          FROM (
              SELECT m.model_id
                FROM vc.provider_model m
               WHERE m.provider_id = v_provider
              UNION
              SELECT p.model_id
                FROM vc.model_unit_price p
               WHERE p.provider_id = v_provider
          ) x
         ORDER BY 1
    LOOP
        PERFORM 1
          FROM vc.model_unit_price p
         WHERE p.provider_id = v_provider
           AND p.model_id = v_model
         FOR UPDATE;

        SELECT count(*) FILTER (WHERE m.state = 'ENABLED')::integer,
               count(*) FILTER (WHERE i.in_1k IS NOT NULL AND i.out_1k IS NOT NULL)::integer,
               min(i.in_1k) FILTER (WHERE i.in_1k IS NOT NULL AND i.out_1k IS NOT NULL),
               min(i.out_1k) FILTER (WHERE i.in_1k IS NOT NULL AND i.out_1k IS NOT NULL)
          INTO v_enabled, v_priced, v_in, v_out
          FROM vc.provider_model m
          LEFT JOIN LATERAL vc.catalog_profile_usd_per_1k(m.pricing, m.state) i ON true
         WHERE m.provider_id = v_provider
           AND m.model_id = v_model;
        v_enabled := coalesce(v_enabled, 0);
        v_priced := coalesce(v_priced, 0);

        SELECT count(*)::integer
          INTO v_distinct
          FROM (
              SELECT DISTINCT i.in_1k, i.out_1k
                FROM vc.provider_model m
                JOIN LATERAL vc.catalog_profile_usd_per_1k(m.pricing, m.state) i ON true
               WHERE m.provider_id = v_provider
                 AND m.model_id = v_model
                 AND i.in_1k IS NOT NULL
                 AND i.out_1k IS NOT NULL
          ) d;
        v_distinct := coalesce(v_distinct, 0);

        IF v_enabled > 0 AND v_enabled = v_priced AND v_distinct = 1 THEN
            SELECT p.input_usd_per_1k, p.output_usd_per_1k
              INTO v_cur_in, v_cur_out
              FROM vc.model_unit_price p
             WHERE p.provider_id = v_provider
               AND p.model_id = v_model
               AND p.active
               AND p.effective_from <= clock_timestamp()
             ORDER BY p.price_version DESC
             LIMIT 1;
            IF NOT FOUND OR v_cur_in IS DISTINCT FROM v_in OR v_cur_out IS DISTINCT FROM v_out THEN
                SELECT coalesce(max(p.price_version), 0) + 1
                  INTO v_next
                  FROM vc.model_unit_price p
                 WHERE p.provider_id = v_provider
                   AND p.model_id = v_model;
                INSERT INTO vc.model_unit_price(
                    provider_id, model_id, price_version,
                    input_usd_per_1k, output_usd_per_1k,
                    effective_from, active)
                VALUES (
                    v_provider, v_model, v_next, v_in, v_out, clock_timestamp(), true);
            END IF;
        ELSIF coalesce(p_retire, false) THEN
            UPDATE vc.model_unit_price p
               SET active = false
             WHERE p.provider_id = v_provider
               AND p.model_id = v_model
               AND p.active;
        END IF;
    END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_admin_upsert_provider_model(
    p_acting_account_id bigint,
    p_provider_id text,
    p_profile_key text,
    p_model_id text,
    p_display_name text,
    p_context_window_tokens integer,
    p_max_output_tokens integer,
    p_state text,
    p_capabilities jsonb,
    p_reasoning_levels text[],
    p_generation_params jsonb,
    p_pricing jsonb)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_provider_id text := btrim(p_provider_id);
    v_profile_key text := btrim(p_profile_key);
    v_model_id text := btrim(p_model_id);
    v_display_name text := btrim(p_display_name);
    v_priority integer;
    v_capabilities jsonb;
    v_levels text[];
    v_params jsonb;
    v_pricing jsonb;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    IF NOT EXISTS (
        SELECT 1 FROM vc.provider_config p WHERE p.provider_id = v_provider_id) THEN
        RAISE EXCEPTION 'go_admin_provider_model: provider not found';
    END IF;
    IF v_profile_key IS NULL OR char_length(v_profile_key) NOT BETWEEN 1 AND 200
       OR v_profile_key ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid profile key';
    END IF;
    IF v_model_id IS NULL OR char_length(v_model_id) NOT BETWEEN 1 AND 200
       OR v_model_id ~ '[[:cntrl:]]' THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid model id';
    END IF;
    IF v_display_name IS NULL OR char_length(v_display_name) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid display name';
    END IF;
    IF p_context_window_tokens IS NOT NULL
       AND p_context_window_tokens NOT BETWEEN 1 AND 2000000 THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid context window';
    END IF;
    IF p_max_output_tokens IS NULL OR p_max_output_tokens NOT BETWEEN 1 AND 262144 THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid max output tokens';
    END IF;
    IF p_state IS NULL OR p_state NOT IN ('ENABLED', 'DISABLED') THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid state';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.provider_model.capacity'));
    SELECT m.priority, m.capabilities, m.reasoning_levels, m.generation_params, m.pricing
      INTO v_priority, v_capabilities, v_levels, v_params, v_pricing
      FROM vc.provider_model m
     WHERE m.provider_id = v_provider_id
       AND m.profile_key = v_profile_key;
    IF NOT FOUND THEN
        IF (SELECT count(*) FROM vc.provider_model) >= 32 THEN
            RAISE EXCEPTION 'go_admin_provider_model: model route capacity reached';
        END IF;
        SELECT COALESCE(max(m.priority), 0) + 1
          INTO v_priority
          FROM vc.provider_model m;
        v_capabilities := '{}'::jsonb;
        v_levels := '{}'::text[];
        v_params := '{}'::jsonb;
        v_pricing := '{}'::jsonb;
    END IF;
    IF p_capabilities IS NOT NULL AND EXISTS (
        SELECT 1 FROM jsonb_each_text(p_capabilities) e
         WHERE e.value = 'VERIFIED'
           AND COALESCE(v_capabilities->>e.key, '') <> 'VERIFIED') THEN
        RAISE EXCEPTION 'go_admin_provider_model: capability verification is not an admin input';
    END IF;
    v_capabilities := COALESCE(p_capabilities, v_capabilities);
    v_levels := COALESCE(p_reasoning_levels, v_levels);
    v_params := COALESCE(p_generation_params, v_params);
    v_pricing := COALESCE(p_pricing, v_pricing);
    IF NOT vc.go_model_capabilities_valid(v_capabilities) THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid capabilities';
    END IF;
    IF NOT vc.go_model_reasoning_levels_valid(v_levels) THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid reasoning levels';
    END IF;
    IF NOT vc.go_model_generation_params_valid(v_params, v_levels) THEN
        RAISE EXCEPTION 'go_admin_provider_model: unsupported generation parameter';
    END IF;
    IF NOT vc.go_model_pricing_valid(v_pricing) THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid pricing';
    END IF;

    INSERT INTO vc.provider_model(
        provider_id, profile_key, model_id, display_name, context_window_tokens,
        max_output_tokens, priority, state, capabilities, reasoning_levels,
        generation_params, pricing, updated_by)
    VALUES (
        v_provider_id, v_profile_key, v_model_id, v_display_name, p_context_window_tokens,
        p_max_output_tokens, v_priority, p_state, v_capabilities, v_levels,
        v_params, v_pricing, p_acting_account_id)
    ON CONFLICT (provider_id, profile_key) DO UPDATE
       SET model_id = EXCLUDED.model_id,
           display_name = EXCLUDED.display_name,
           context_window_tokens = EXCLUDED.context_window_tokens,
           max_output_tokens = EXCLUDED.max_output_tokens,
           state = EXCLUDED.state,
           capabilities = EXCLUDED.capabilities,
           reasoning_levels = EXCLUDED.reasoning_levels,
           generation_params = EXCLUDED.generation_params,
           pricing = EXCLUDED.pricing,
           updated_by = EXCLUDED.updated_by,
           updated_at = now();
    PERFORM vc.sync_provider_model_ledger(v_provider_id, true);
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_admin_delete_provider_models_except(
    p_acting_account_id bigint,
    p_provider_id text,
    p_profile_keys text[])
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_in_use text;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    SELECT string_agg(b.purpose, ',' ORDER BY b.purpose)
      INTO v_in_use
      FROM vc.model_purpose_binding b
     WHERE b.provider_id = btrim(p_provider_id)
       AND (p_profile_keys IS NULL OR NOT (b.profile_key = ANY(p_profile_keys)));
    IF v_in_use IS NOT NULL THEN
        RAISE EXCEPTION 'go_admin_provider_model: profile in use: %', v_in_use;
    END IF;
    DELETE FROM vc.provider_model m
     WHERE m.provider_id = btrim(p_provider_id)
       AND (p_profile_keys IS NULL OR NOT (m.profile_key = ANY(p_profile_keys)));
    PERFORM vc.sync_provider_model_ledger(btrim(p_provider_id), true);
END;
$$;

DROP FUNCTION vc.go_admin_list_provider_models(bigint);

CREATE FUNCTION vc.go_admin_list_provider_models(p_acting_account_id bigint)
    RETURNS TABLE(
        out_provider_id text,
        out_display_name text,
        out_protocol text,
        out_base_url text,
        out_credential_configured boolean,
        out_provider_state text,
        out_provider_revision bigint,
        out_provider_updated_at timestamptz,
        out_profile_key text,
        out_model_id text,
        out_model_display_name text,
        out_context_window_tokens integer,
        out_max_output_tokens integer,
        out_priority integer,
        out_model_state text,
        out_capabilities jsonb,
        out_reasoning_levels text[],
        out_generation_params jsonb,
        out_pricing jsonb,
        out_bound_purposes text[],
        out_model_updated_at timestamptz,
        out_ledger_price text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    RETURN QUERY
    SELECT p.provider_id, p.display_name, p.protocol, p.base_url,
           p.credential_cipher IS NOT NULL, p.state, p.revision, p.updated_at,
           m.profile_key, m.model_id, m.display_name, m.context_window_tokens,
           m.max_output_tokens, m.priority, m.state,
           m.capabilities, m.reasoning_levels, m.generation_params, m.pricing,
           COALESCE((
               SELECT array_agg(b.purpose ORDER BY b.purpose)
                 FROM vc.model_purpose_binding b
                WHERE b.provider_id = m.provider_id
                  AND b.profile_key = m.profile_key), '{}'::text[]),
           m.updated_at,
           CASE WHEN m.profile_key IS NULL THEN NULL
                ELSE vc.profile_ledger_price_status(
                         m.provider_id, m.model_id, m.state, m.pricing) END
      FROM vc.provider_config p
      LEFT JOIN vc.provider_model m ON m.provider_id = p.provider_id
     ORDER BY p.created_at, p.provider_id, m.priority, m.profile_key;
END;
$$;

REVOKE ALL ON FUNCTION vc.catalog_usd_per_1k(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.catalog_profile_usd_per_1k(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.profile_ledger_price_status(text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.sync_provider_model_ledger(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_list_provider_models(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_admin_list_provider_models(bigint) TO vc_api;

-- Existing catalogs: publish a unanimous enabled USD price once. Do not
-- retire prices that the catalog does not currently support.
SELECT vc.sync_provider_model_ledger(p.provider_id, false)
  FROM (SELECT DISTINCT provider_id FROM vc.provider_model) p;
