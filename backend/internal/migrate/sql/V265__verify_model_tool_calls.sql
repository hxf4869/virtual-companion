-- Explicit tool-call verification is the only writer of toolCalls=VERIFIED.
-- An administrator save may still echo an already verified field (V140) but
-- cannot upgrade one. Changing the provider base URL, protocol, or the
-- profile's remote model id downgrades that field to DECLARED and clears the
-- verification record. The record stores when and under which protocol, base
-- URL, and model id the probe succeeded.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.provider_model
    ADD COLUMN tool_calls_verified_at timestamptz,
    ADD COLUMN tool_calls_verified_protocol text,
    ADD COLUMN tool_calls_verified_base_url text,
    ADD COLUMN tool_calls_verified_model_id text;

ALTER TABLE vc.provider_model
    ADD CONSTRAINT provider_model_tool_calls_verification_check CHECK (
        (tool_calls_verified_at IS NULL
            AND tool_calls_verified_protocol IS NULL
            AND tool_calls_verified_base_url IS NULL
            AND tool_calls_verified_model_id IS NULL)
        OR (tool_calls_verified_at IS NOT NULL
            AND tool_calls_verified_protocol IN (
                'OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES')
            AND tool_calls_verified_base_url IS NOT NULL
            AND char_length(tool_calls_verified_base_url) BETWEEN 1 AND 2048
            AND tool_calls_verified_model_id IS NOT NULL
            AND char_length(tool_calls_verified_model_id) BETWEEN 1 AND 200
            AND COALESCE(capabilities->>'toolCalls', '') = 'VERIFIED'));

CREATE OR REPLACE FUNCTION vc.go_admin_upsert_provider(
    p_acting_account_id bigint,
    p_provider_id text,
    p_display_name text,
    p_protocol text,
    p_base_url text,
    p_credential_action text,
    p_credential_cipher text,
    p_state text,
    p_expected_revision bigint,
    p_bump_revision boolean)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_provider_id text := btrim(p_provider_id);
    v_display_name text := btrim(p_display_name);
    v_base_url text := btrim(p_base_url);
    v_exists boolean;
    v_revision bigint;
    v_cipher text;
    v_old_protocol text;
    v_old_base_url text;
    v_next_cipher text;
    v_next_revision bigint;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    IF v_provider_id IS NULL OR v_provider_id !~ '^[a-z][a-z0-9-]{0,63}$' THEN
        RAISE EXCEPTION 'go_admin_provider: invalid provider id';
    END IF;
    IF v_display_name IS NULL OR char_length(v_display_name) NOT BETWEEN 1 AND 80 THEN
        RAISE EXCEPTION 'go_admin_provider: invalid display name';
    END IF;
    IF p_protocol IS NULL OR p_protocol NOT IN (
            'OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES') THEN
        RAISE EXCEPTION 'go_admin_provider: unsupported protocol';
    END IF;
    IF v_base_url IS NULL OR char_length(v_base_url) NOT BETWEEN 1 AND 2048 THEN
        RAISE EXCEPTION 'go_admin_provider: invalid base url';
    END IF;
    IF p_state IS NULL OR p_state NOT IN ('ENABLED', 'DISABLED') THEN
        RAISE EXCEPTION 'go_admin_provider: invalid state';
    END IF;
    IF p_credential_action IS NULL OR p_credential_action NOT IN ('KEEP', 'SET', 'CLEAR') THEN
        RAISE EXCEPTION 'go_admin_provider: invalid credential action';
    END IF;
    IF p_credential_action = 'SET' AND (
           p_credential_cipher IS NULL
           OR p_credential_cipher NOT LIKE 'enc2:%'
           OR char_length(p_credential_cipher) > 8192) THEN
        RAISE EXCEPTION 'go_admin_provider: invalid credential envelope';
    END IF;
    IF p_credential_action <> 'SET' AND p_credential_cipher IS NOT NULL THEN
        RAISE EXCEPTION 'go_admin_provider: invalid credential action';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.provider_config.capacity'));
    SELECT p.revision, p.credential_cipher, p.protocol, p.base_url
      INTO v_revision, v_cipher, v_old_protocol, v_old_base_url
      FROM vc.provider_config p
     WHERE p.provider_id = v_provider_id
       FOR UPDATE;
    v_exists := FOUND;
    IF NOT v_exists THEN
        v_revision := 0;
        IF (SELECT count(*) FROM vc.provider_config) >= 8 THEN
            RAISE EXCEPTION 'go_admin_provider: provider capacity reached';
        END IF;
    ELSIF v_old_protocol IS DISTINCT FROM p_protocol
       OR v_old_base_url IS DISTINCT FROM v_base_url THEN
        -- Visible to the later model upserts in this transaction. A save that
        -- only echoes VERIFIED still succeeds, then those upserts downgrade.
        -- search_path excludes pg_temp, so the session table must be qualified.
        CREATE TEMP TABLE IF NOT EXISTS pg_temp.vc_tool_calls_binding_changed (
            provider_id text PRIMARY KEY
        ) ON COMMIT DROP;
        INSERT INTO pg_temp.vc_tool_calls_binding_changed(provider_id)
        VALUES (v_provider_id)
        ON CONFLICT (provider_id) DO NOTHING;
    END IF;
    IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_revision THEN
        RAISE EXCEPTION 'go_admin_provider: revision conflict (current %)', v_revision;
    END IF;

    v_next_cipher := CASE p_credential_action
                         WHEN 'SET' THEN p_credential_cipher
                         WHEN 'CLEAR' THEN NULL
                         ELSE v_cipher END;
    IF p_state = 'ENABLED' AND v_next_cipher IS NULL THEN
        RAISE EXCEPTION 'go_admin_provider: enabled provider requires a credential';
    END IF;
    IF p_state = 'ENABLED' AND NOT EXISTS (
        SELECT 1
          FROM vc.provider_model m
         WHERE m.provider_id = v_provider_id
           AND m.state = 'ENABLED') THEN
        RAISE EXCEPTION 'go_admin_provider: enabled provider requires an enabled model';
    END IF;
    v_next_revision := CASE WHEN NOT v_exists THEN
                                CASE WHEN p_bump_revision THEN 1 ELSE 0 END
                            WHEN p_bump_revision THEN v_revision + 1
                            ELSE v_revision END;

    IF v_exists THEN
        UPDATE vc.provider_config p
           SET display_name = v_display_name,
               protocol = p_protocol,
               base_url = v_base_url,
               credential_cipher = v_next_cipher,
               state = p_state,
               revision = v_next_revision,
               updated_by = p_acting_account_id,
               updated_at = now()
         WHERE p.provider_id = v_provider_id;
    ELSE
        INSERT INTO vc.provider_config(
            provider_id, display_name, protocol, base_url,
            credential_cipher, state, revision, updated_by)
        VALUES (
            v_provider_id, v_display_name, p_protocol, v_base_url,
            v_next_cipher, p_state, v_next_revision, p_acting_account_id);
    END IF;

    INSERT INTO vc.provider_deployment(
        provider_id, protocol, capabilities, admission_state)
    VALUES (
        v_provider_id, p_protocol, ARRAY['TEXT', 'STREAMING', 'USAGE'],
        CASE WHEN p_state = 'ENABLED' THEN 'ADMITTED' ELSE 'DISABLED' END)
    ON CONFLICT (provider_id) DO UPDATE
       SET protocol = EXCLUDED.protocol,
           capabilities = EXCLUDED.capabilities,
           admission_state = EXCLUDED.admission_state,
           updated_at = now();
    RETURN v_next_revision;
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
    IF p_max_output_tokens IS NULL OR p_max_output_tokens NOT BETWEEN 1 AND 262144 THEN
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

CREATE FUNCTION vc.go_admin_mark_model_tool_calls_verified(
    p_acting_account_id bigint,
    p_provider_id text,
    p_profile_key text)
    RETURNS TABLE(out_verified_at timestamptz, out_protocol text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_protocol text;
    v_base_url text;
    v_model_id text;
    v_at timestamptz;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    SELECT p.protocol, p.base_url, m.model_id
      INTO v_protocol, v_base_url, v_model_id
      FROM vc.provider_config p
      JOIN vc.provider_model m ON m.provider_id = p.provider_id
     WHERE p.provider_id = btrim(p_provider_id)
       AND m.profile_key = btrim(p_profile_key);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_admin_provider_model: profile not found';
    END IF;
    v_at := clock_timestamp();
    UPDATE vc.provider_model m
       SET capabilities = jsonb_set(COALESCE(m.capabilities, '{}'::jsonb), '{toolCalls}', '"VERIFIED"', true),
           tool_calls_verified_at = v_at,
           tool_calls_verified_protocol = v_protocol,
           tool_calls_verified_base_url = v_base_url,
           tool_calls_verified_model_id = v_model_id,
           updated_by = p_acting_account_id,
           updated_at = now()
     WHERE m.provider_id = btrim(p_provider_id)
       AND m.profile_key = btrim(p_profile_key);
    RETURN QUERY SELECT v_at, v_protocol;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_admin_mark_model_tool_calls_verified(bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_admin_mark_model_tool_calls_verified(bigint, text, text) TO vc_api;
