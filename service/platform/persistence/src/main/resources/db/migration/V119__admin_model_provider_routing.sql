-- G12 dogfood: administrator-owned model providers and one deterministic
-- global route chain. Credentials remain application-layer enc2 envelopes;
-- neither runtime role receives direct table access.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.provider_config (
    provider_id       text PRIMARY KEY,
    display_name      text NOT NULL,
    protocol          text NOT NULL,
    base_url          text NOT NULL,
    credential_cipher text NOT NULL,
    state             text NOT NULL,
    updated_by        bigint NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT provider_config_id_check CHECK (
        provider_id = lower(provider_id)
        AND provider_id ~ '^[a-z][a-z0-9-]{0,63}$'),
    CONSTRAINT provider_config_display_name_check CHECK (
        char_length(btrim(display_name)) BETWEEN 1 AND 80),
    CONSTRAINT provider_config_protocol_check CHECK (
        protocol IN (
            'OPENAI_CHAT_COMPLETIONS',
            'OPENAI_RESPONSES',
            'ANTHROPIC_MESSAGES')),
    CONSTRAINT provider_config_base_url_check CHECK (
        char_length(base_url) BETWEEN 1 AND 2048),
    CONSTRAINT provider_config_credential_check CHECK (
        credential_cipher LIKE 'enc2:%'
        AND char_length(credential_cipher) <= 8192),
    CONSTRAINT provider_config_state_check CHECK (
        state IN ('ENABLED', 'DISABLED'))
);

CREATE TABLE vc.provider_model (
    provider_id          text NOT NULL,
    model_id             text NOT NULL,
    display_name         text NOT NULL,
    context_window_tokens integer,
    max_output_tokens    integer NOT NULL,
    priority             integer NOT NULL,
    state                text NOT NULL,
    updated_by           bigint NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_id, model_id),
    FOREIGN KEY (provider_id) REFERENCES vc.provider_config(provider_id)
        ON DELETE RESTRICT,
    CONSTRAINT provider_model_id_check CHECK (
        char_length(btrim(model_id)) BETWEEN 1 AND 200
        AND model_id !~ '[[:cntrl:]]'),
    CONSTRAINT provider_model_display_name_check CHECK (
        char_length(btrim(display_name)) BETWEEN 1 AND 100),
    CONSTRAINT provider_model_context_check CHECK (
        context_window_tokens IS NULL
        OR context_window_tokens BETWEEN 1 AND 2000000),
    CONSTRAINT provider_model_output_check CHECK (
        max_output_tokens BETWEEN 1 AND 262144),
    CONSTRAINT provider_model_priority_check CHECK (
        priority BETWEEN 1 AND 32),
    CONSTRAINT provider_model_state_check CHECK (
        state IN ('ENABLED', 'DISABLED')),
    CONSTRAINT provider_model_priority_unique UNIQUE (priority)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX provider_model_live_route_idx
    ON vc.provider_model (priority, provider_id, model_id)
    WHERE state = 'ENABLED';

REVOKE ALL ON TABLE vc.provider_config, vc.provider_model
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.go_admin_assert_provider_actor(p_acting_account_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0
       OR NOT EXISTS (
           SELECT 1
             FROM vc.identity_account a
            WHERE a.id = p_acting_account_id
              AND a.role = 'ADMIN'
              AND a.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_admin_provider: caller is not an active ADMIN';
    END IF;
END;
$$;

CREATE FUNCTION vc.go_admin_list_provider_models(p_acting_account_id bigint)
    RETURNS TABLE(
        out_provider_id text,
        out_display_name text,
        out_protocol text,
        out_base_url text,
        out_credential_configured boolean,
        out_provider_state text,
        out_provider_updated_at timestamptz,
        out_model_id text,
        out_model_display_name text,
        out_context_window_tokens integer,
        out_max_output_tokens integer,
        out_priority integer,
        out_model_state text,
        out_model_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    RETURN QUERY
    SELECT p.provider_id, p.display_name, p.protocol, p.base_url,
           p.credential_cipher <> '', p.state, p.updated_at,
           m.model_id, m.display_name, m.context_window_tokens,
           m.max_output_tokens, m.priority, m.state, m.updated_at
      FROM vc.provider_config p
      LEFT JOIN vc.provider_model m ON m.provider_id = p.provider_id
     ORDER BY p.created_at, p.provider_id, m.priority, m.model_id;
END;
$$;

-- Credential retrieval is deliberately a narrow ADMIN-only function. The
-- caller receives the enc2 envelope and decrypts it only in Go process memory.
CREATE FUNCTION vc.go_admin_get_provider_credential(
    p_acting_account_id bigint,
    p_provider_id text)
    RETURNS TABLE(out_credential_cipher text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    RETURN QUERY
    SELECT p.credential_cipher
      FROM vc.provider_config p
     WHERE p.provider_id = btrim(p_provider_id);
END;
$$;

CREATE FUNCTION vc.go_admin_upsert_provider(
    p_acting_account_id bigint,
    p_provider_id text,
    p_display_name text,
    p_protocol text,
    p_base_url text,
    p_credential_cipher text,
    p_state text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_provider_id text := btrim(p_provider_id);
    v_display_name text := btrim(p_display_name);
    v_base_url text := btrim(p_base_url);
    v_exists boolean;
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
    IF p_credential_cipher IS NOT NULL
       AND (p_credential_cipher NOT LIKE 'enc2:%'
            OR char_length(p_credential_cipher) > 8192) THEN
        RAISE EXCEPTION 'go_admin_provider: invalid credential envelope';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext('vc.provider_config.capacity'));
    SELECT EXISTS (
        SELECT 1 FROM vc.provider_config p WHERE p.provider_id = v_provider_id)
      INTO v_exists;
    IF NOT v_exists AND (SELECT count(*) FROM vc.provider_config) >= 8 THEN
        RAISE EXCEPTION 'go_admin_provider: provider capacity reached';
    END IF;
    IF NOT v_exists AND p_credential_cipher IS NULL THEN
        RAISE EXCEPTION 'go_admin_provider: credential is required';
    END IF;
    IF p_state = 'ENABLED' AND NOT EXISTS (
        SELECT 1
          FROM vc.provider_model m
         WHERE m.provider_id = v_provider_id
           AND m.state = 'ENABLED') THEN
        RAISE EXCEPTION 'go_admin_provider: enabled provider requires an enabled model';
    END IF;

    IF v_exists THEN
        UPDATE vc.provider_config p
           SET display_name = v_display_name,
               protocol = p_protocol,
               base_url = v_base_url,
               credential_cipher = COALESCE(
                   p_credential_cipher, p.credential_cipher),
               state = p_state,
               updated_by = p_acting_account_id,
               updated_at = now()
         WHERE p.provider_id = v_provider_id;
    ELSE
        INSERT INTO vc.provider_config(
            provider_id, display_name, protocol, base_url,
            credential_cipher, state, updated_by)
        VALUES (
            v_provider_id, v_display_name, p_protocol, v_base_url,
            p_credential_cipher, p_state, p_acting_account_id);
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
END;
$$;

CREATE FUNCTION vc.go_admin_upsert_provider_model(
    p_acting_account_id bigint,
    p_provider_id text,
    p_model_id text,
    p_display_name text,
    p_context_window_tokens integer,
    p_max_output_tokens integer,
    p_state text)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_provider_id text := btrim(p_provider_id);
    v_model_id text := btrim(p_model_id);
    v_display_name text := btrim(p_display_name);
    v_priority integer;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    IF NOT EXISTS (
        SELECT 1 FROM vc.provider_config p WHERE p.provider_id = v_provider_id) THEN
        RAISE EXCEPTION 'go_admin_provider_model: provider not found';
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
    SELECT m.priority
      INTO v_priority
      FROM vc.provider_model m
     WHERE m.provider_id = v_provider_id
       AND m.model_id = v_model_id;
    IF NOT FOUND THEN
        IF (SELECT count(*) FROM vc.provider_model) >= 32 THEN
            RAISE EXCEPTION 'go_admin_provider_model: model route capacity reached';
        END IF;
        SELECT COALESCE(max(m.priority), 0) + 1
          INTO v_priority
          FROM vc.provider_model m;
    END IF;

    INSERT INTO vc.provider_model(
        provider_id, model_id, display_name, context_window_tokens,
        max_output_tokens, priority, state, updated_by)
    VALUES (
        v_provider_id, v_model_id, v_display_name, p_context_window_tokens,
        p_max_output_tokens, v_priority, p_state, p_acting_account_id)
    ON CONFLICT (provider_id, model_id) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           context_window_tokens = EXCLUDED.context_window_tokens,
           max_output_tokens = EXCLUDED.max_output_tokens,
           state = EXCLUDED.state,
           updated_by = EXCLUDED.updated_by,
           updated_at = now();
END;
$$;

CREATE FUNCTION vc.go_admin_delete_provider_models_except(
    p_acting_account_id bigint,
    p_provider_id text,
    p_model_ids text[])
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    DELETE FROM vc.provider_model m
     WHERE m.provider_id = btrim(p_provider_id)
       AND (p_model_ids IS NULL OR NOT (m.model_id = ANY(p_model_ids)));
END;
$$;

CREATE FUNCTION vc.go_admin_normalize_provider_model_priorities(
    p_acting_account_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    WITH ranked AS (
        SELECT m.provider_id, m.model_id,
               row_number() OVER (
                   ORDER BY CASE WHEN p.state = 'ENABLED' AND m.state = 'ENABLED'
                                 THEN 0 ELSE 1 END,
                            m.priority, m.provider_id, m.model_id)::integer AS next_priority
          FROM vc.provider_model m
          JOIN vc.provider_config p ON p.provider_id = m.provider_id
    )
    UPDATE vc.provider_model m
       SET priority = r.next_priority
      FROM ranked r
     WHERE m.provider_id = r.provider_id
       AND m.model_id = r.model_id
       AND m.priority IS DISTINCT FROM r.next_priority;
END;
$$;

CREATE FUNCTION vc.go_admin_reorder_provider_models(
    p_acting_account_id bigint,
    p_order jsonb)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_expected integer;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    IF p_order IS NULL OR jsonb_typeof(p_order) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'go_admin_provider_order: order must be an array';
    END IF;
    SELECT count(*)::integer
      INTO v_expected
      FROM vc.provider_model m
      JOIN vc.provider_config p ON p.provider_id = m.provider_id
     WHERE p.state = 'ENABLED' AND m.state = 'ENABLED';
    IF jsonb_array_length(p_order) <> v_expected THEN
        RAISE EXCEPTION 'go_admin_provider_order: order must contain every enabled model';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_order) e
         WHERE jsonb_typeof(e) IS DISTINCT FROM 'object'
            OR btrim(e->>'providerId') = ''
            OR btrim(e->>'modelId') = '') THEN
        RAISE EXCEPTION 'go_admin_provider_order: invalid route';
    END IF;
    IF (
        SELECT count(DISTINCT (btrim(e->>'providerId'), btrim(e->>'modelId')))
          FROM jsonb_array_elements(p_order) e) <> v_expected THEN
        RAISE EXCEPTION 'go_admin_provider_order: duplicate route';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM jsonb_array_elements(p_order) e
          LEFT JOIN vc.provider_config p
            ON p.provider_id = btrim(e->>'providerId') AND p.state = 'ENABLED'
          LEFT JOIN vc.provider_model m
            ON m.provider_id = p.provider_id
           AND m.model_id = btrim(e->>'modelId')
           AND m.state = 'ENABLED'
         WHERE m.model_id IS NULL) THEN
        RAISE EXCEPTION 'go_admin_provider_order: route is not enabled';
    END IF;

    WITH desired AS (
        SELECT btrim(e->>'providerId') AS provider_id,
               btrim(e->>'modelId') AS model_id,
               ordinality::integer AS priority
          FROM jsonb_array_elements(p_order) WITH ORDINALITY AS x(e, ordinality)
    )
    UPDATE vc.provider_model m
       SET priority = d.priority,
           updated_by = p_acting_account_id,
           updated_at = now()
      FROM desired d
     WHERE m.provider_id = d.provider_id
       AND m.model_id = d.model_id;

    PERFORM vc.go_admin_normalize_provider_model_priorities(p_acting_account_id);
END;
$$;

CREATE FUNCTION vc.go_resolve_model_routes()
    RETURNS TABLE(
        out_provider_id text,
        out_supplier_name text,
        out_protocol text,
        out_base_url text,
        out_credential_cipher text,
        out_model_id text,
        out_max_output_tokens integer,
        out_priority integer)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT p.provider_id, p.display_name, p.protocol, p.base_url,
           p.credential_cipher, m.model_id, m.max_output_tokens, m.priority
      FROM vc.provider_config p
      JOIN vc.provider_model m ON m.provider_id = p.provider_id
      JOIN vc.provider_deployment d
        ON d.provider_id = p.provider_id
       AND d.protocol = p.protocol
       AND d.admission_state = 'ADMITTED'
     WHERE p.state = 'ENABLED'
       AND m.state = 'ENABLED'
     ORDER BY m.priority, p.provider_id, m.model_id
     LIMIT 2;
$$;

-- V118 admitted only Chat Completions. The same atomic consent/admission gate
-- now accepts exactly the three administrator-configurable live protocols.
CREATE OR REPLACE FUNCTION vc.go_prepare_model_attempt(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_generation_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_provider_id text,
    p_supplier_name text,
    p_model_id text,
    p_effective_categories text[],
    p_consent_version text,
    p_provider_contract_version text,
    p_prompt_version text,
    p_persona_version text,
    p_config_version text,
    p_reserved_cost bigint,
    p_hard_limit bigint)
    RETURNS TABLE(out_attempt_id bigint, out_attempt_no integer, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_admission text;
    v_protocol text;
BEGIN
    PERFORM vc.go_lock_outbound_owner(p_owner_user_id);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'go_prepare_model_attempt: outbound is not currently authorized';
    END IF;
    IF EXISTS (
        WITH required(consent_type) AS (
            VALUES ('SERVICE_TERMS'), ('PRIVACY_POLICY'),
                   ('AI_CONTENT_NOTICE'), ('THIRD_PARTY_MODEL_PROCESSING'),
                   ('SENSITIVE_DATA_PROCESSING'))
        SELECT 1
          FROM required r
          LEFT JOIN LATERAL (
              SELECT c.granted
                FROM vc.consent_record c
               WHERE c.owner_user_id = p_owner_user_id
                 AND c.consent_type = r.consent_type
               ORDER BY c.id DESC
               LIMIT 1
          ) latest ON true
         WHERE latest.granted IS DISTINCT FROM true) THEN
        RAISE EXCEPTION 'go_prepare_model_attempt: outbound is not currently authorized';
    END IF;

    SELECT d.admission_state, d.protocol
      INTO v_admission, v_protocol
      FROM vc.provider_deployment d
     WHERE d.provider_id = p_provider_id
     FOR SHARE;
    IF NOT FOUND OR v_admission IS DISTINCT FROM 'ADMITTED'
       OR v_protocol NOT IN (
           'OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES') THEN
        RAISE EXCEPTION 'go_prepare_model_attempt: provider is not currently admitted';
    END IF;

    RETURN QUERY
        SELECT a.out_attempt_id, a.out_attempt_no, a.out_provider_attempt_id
          FROM vc.go_create_model_attempt(
              p_owner_user_id, p_work_item_id, p_generation_id,
              p_claim_token, p_claim_fence, p_provider_id, p_supplier_name,
              p_model_id, p_effective_categories, p_consent_version,
              p_provider_contract_version, p_prompt_version, p_persona_version,
              p_config_version, p_reserved_cost, p_hard_limit) a;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_admin_assert_provider_actor(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_list_provider_models(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_get_provider_credential(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_upsert_provider(bigint, text, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_upsert_provider_model(bigint, text, text, text, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_delete_provider_models_except(bigint, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_normalize_provider_model_priorities(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_reorder_provider_models(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_resolve_model_routes() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.go_admin_list_provider_models(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_get_provider_credential(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_upsert_provider(bigint, text, text, text, text, text, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_upsert_provider_model(bigint, text, text, text, integer, integer, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_delete_provider_models_except(bigint, text, text[]) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_normalize_provider_model_priorities(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_reorder_provider_models(bigint, jsonb) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_resolve_model_routes() TO vc_api, vc_worker;
