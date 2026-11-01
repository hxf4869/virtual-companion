-- MDL-1（Owner 2026-11-02）：模型最大输出上限从 262144（256k）放宽到 393216（384k）。
-- 只改表约束与 go_admin_upsert_provider_model 的同一校验，函数其余逻辑与 V265 一致。

ALTER TABLE vc.provider_model DROP CONSTRAINT provider_model_output_check;
ALTER TABLE vc.provider_model ADD CONSTRAINT provider_model_output_check CHECK (
    max_output_tokens BETWEEN 1 AND 393216);

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
    v_prev_model_id text;
    v_verified_protocol text;
    v_verified_base_url text;
    v_verified_model_id text;
    v_provider_protocol text;
    v_provider_base_url text;
    v_binding_changed boolean := false;
    v_downgrade boolean;
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
    IF p_max_output_tokens IS NULL OR p_max_output_tokens NOT BETWEEN 1 AND 393216 THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid max output tokens';
    END IF;
    IF p_state IS NULL OR p_state NOT IN ('ENABLED', 'DISABLED') THEN
        RAISE EXCEPTION 'go_admin_provider_model: invalid state';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.provider_model.capacity'));
    SELECT m.priority, m.capabilities, m.reasoning_levels, m.generation_params, m.pricing,
           m.model_id, m.tool_calls_verified_protocol, m.tool_calls_verified_base_url,
           m.tool_calls_verified_model_id
      INTO v_priority, v_capabilities, v_levels, v_params, v_pricing,
           v_prev_model_id, v_verified_protocol, v_verified_base_url, v_verified_model_id
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
        v_prev_model_id := NULL;
        v_verified_protocol := NULL;
        v_verified_base_url := NULL;
        v_verified_model_id := NULL;
    END IF;
    -- VERIFIED is written only by go_admin_mark_model_tool_calls_verified.
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
    SELECT p.protocol, p.base_url
      INTO v_provider_protocol, v_provider_base_url
      FROM vc.provider_config p
     WHERE p.provider_id = v_provider_id;
    -- A static FROM would be planned even when the table is absent and
    -- fail every ordinary save. EXECUTE runs only after to_regclass.
    IF to_regclass('pg_temp.vc_tool_calls_binding_changed') IS NOT NULL THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM pg_temp.vc_tool_calls_binding_changed c WHERE c.provider_id = $1)'
           INTO v_binding_changed
          USING v_provider_id;
    END IF;
    v_downgrade := v_binding_changed
        OR (v_prev_model_id IS NOT NULL AND v_prev_model_id IS DISTINCT FROM v_model_id)
        OR (v_verified_protocol IS NOT NULL AND v_verified_protocol IS DISTINCT FROM v_provider_protocol)
        OR (v_verified_base_url IS NOT NULL AND v_verified_base_url IS DISTINCT FROM v_provider_base_url)
        OR (v_verified_model_id IS NOT NULL AND v_verified_model_id IS DISTINCT FROM v_model_id);
    IF v_downgrade AND COALESCE(v_capabilities->>'toolCalls', '') = 'VERIFIED' THEN
        v_capabilities := jsonb_set(v_capabilities, '{toolCalls}', '"DECLARED"', true);
    END IF;
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
           tool_calls_verified_at = CASE
               WHEN EXCLUDED.capabilities->>'toolCalls' = 'VERIFIED'
               THEN vc.provider_model.tool_calls_verified_at ELSE NULL END,
           tool_calls_verified_protocol = CASE
               WHEN EXCLUDED.capabilities->>'toolCalls' = 'VERIFIED'
               THEN vc.provider_model.tool_calls_verified_protocol ELSE NULL END,
           tool_calls_verified_base_url = CASE
               WHEN EXCLUDED.capabilities->>'toolCalls' = 'VERIFIED'
               THEN vc.provider_model.tool_calls_verified_base_url ELSE NULL END,
           tool_calls_verified_model_id = CASE
               WHEN EXCLUDED.capabilities->>'toolCalls' = 'VERIFIED'
               THEN vc.provider_model.tool_calls_verified_model_id ELSE NULL END,
           updated_by = EXCLUDED.updated_by,
           updated_at = now();
    PERFORM vc.sync_provider_model_ledger(v_provider_id, true);
END;
$$;
