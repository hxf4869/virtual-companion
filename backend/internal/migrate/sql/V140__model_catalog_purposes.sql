-- V2-W03: Go model catalog is the single credential authority. Providers gain
-- an optimistic-concurrency revision and may be saved as credential-less
-- drafts; models become profiles (provider_id, profile_key) carrying declared
-- capabilities, bounded generation params and pricing; six fixed purposes bind
-- to one profile each. Neither runtime role receives direct table access.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.provider_config
    ALTER COLUMN credential_cipher DROP NOT NULL,
    DROP CONSTRAINT provider_config_credential_check,
    ADD CONSTRAINT provider_config_credential_check CHECK (
        credential_cipher IS NULL
        OR (credential_cipher LIKE 'enc2:%'
            AND char_length(credential_cipher) <= 8192)),
    ADD COLUMN revision bigint NOT NULL DEFAULT 1,
    ADD CONSTRAINT provider_config_enabled_requires_credential CHECK (
        state <> 'ENABLED' OR credential_cipher IS NOT NULL);

-- CHECK constraints cannot hold subqueries; the document validators are
-- IMMUTABLE functions so the table keeps one DB-level guarantee.
CREATE FUNCTION vc.go_model_capabilities_valid(p jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT p IS NOT NULL AND jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) e
            WHERE e.key NOT IN ('imageInput', 'videoInput', 'pdfInput',
                                'structuredOutput', 'toolCalls',
                                'nativeWebSearch', 'systemMessage')
               OR jsonb_typeof(e.value) <> 'string'
               OR (e.value #>> '{}') NOT IN (
                   'UNKNOWN', 'DECLARED', 'VERIFIED', 'UNSUPPORTED'))
$$;

CREATE FUNCTION vc.go_model_reasoning_levels_valid(p text[])
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT p IS NOT NULL
       AND cardinality(p) <= 8
       AND cardinality(p) = (SELECT count(DISTINCT l) FROM unnest(p) l)
       AND NOT EXISTS (
           SELECT 1 FROM unnest(p) l WHERE l !~ '^[a-z0-9_-]{1,32}$')
$$;

CREATE FUNCTION vc.go_model_generation_params_valid(p jsonb, p_levels text[])
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT p IS NOT NULL AND jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) e
            WHERE e.key NOT IN ('temperature', 'topP', 'reasoningEffort'))
       AND CASE jsonb_typeof(p->'temperature')
               WHEN 'number' THEN (p->>'temperature')::numeric BETWEEN 0 AND 2
               WHEN 'null' THEN true
               ELSE p->'temperature' IS NULL END
       AND CASE jsonb_typeof(p->'topP')
               WHEN 'number' THEN (p->>'topP')::numeric BETWEEN 0 AND 1
               WHEN 'null' THEN true
               ELSE p->'topP' IS NULL END
       AND CASE jsonb_typeof(p->'reasoningEffort')
               WHEN 'string' THEN (p->>'reasoningEffort') = ANY(p_levels)
               WHEN 'null' THEN true
               ELSE p->'reasoningEffort' IS NULL END
$$;

-- Prices are optional metadata. Absent values mean unknown, never free; any
-- stated price requires its currency.
CREATE FUNCTION vc.go_model_pricing_valid(p jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT p IS NOT NULL AND jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) e
            WHERE e.key NOT IN ('currency', 'inputPerMillionTokens',
                                'outputPerMillionTokens', 'verifiedOn'))
       AND CASE jsonb_typeof(p->'currency')
               WHEN 'string' THEN (p->>'currency') ~ '^[A-Z]{3}$'
               WHEN 'null' THEN true
               ELSE p->'currency' IS NULL END
       AND CASE jsonb_typeof(p->'inputPerMillionTokens')
               WHEN 'number' THEN (p->>'inputPerMillionTokens')::numeric >= 0
               WHEN 'null' THEN true
               ELSE p->'inputPerMillionTokens' IS NULL END
       AND CASE jsonb_typeof(p->'outputPerMillionTokens')
               WHEN 'number' THEN (p->>'outputPerMillionTokens')::numeric >= 0
               WHEN 'null' THEN true
               ELSE p->'outputPerMillionTokens' IS NULL END
       AND CASE jsonb_typeof(p->'verifiedOn')
               WHEN 'string' THEN (p->>'verifiedOn') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
               WHEN 'null' THEN true
               ELSE p->'verifiedOn' IS NULL END
       AND ((jsonb_typeof(p->'inputPerMillionTokens') IS DISTINCT FROM 'number'
             AND jsonb_typeof(p->'outputPerMillionTokens') IS DISTINCT FROM 'number')
            OR COALESCE(jsonb_typeof(p->'currency') = 'string', false))
$$;

-- A profile is one configured use of a remote model. "Save as new" keeps the
-- remote model_id and takes a distinct profile_key; existing rows keep
-- profile_key = model_id so older callers address them unchanged.
ALTER TABLE vc.provider_model
    ADD COLUMN profile_key text,
    ADD COLUMN capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN reasoning_levels text[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN generation_params jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN pricing jsonb NOT NULL DEFAULT '{}'::jsonb;
UPDATE vc.provider_model SET profile_key = model_id WHERE profile_key IS NULL;
ALTER TABLE vc.provider_model
    ALTER COLUMN profile_key SET NOT NULL,
    DROP CONSTRAINT provider_model_pkey,
    ADD PRIMARY KEY (provider_id, profile_key),
    ADD CONSTRAINT provider_model_profile_key_check CHECK (
        char_length(btrim(profile_key)) BETWEEN 1 AND 200
        AND profile_key !~ '[[:cntrl:]]'),
    ADD CONSTRAINT provider_model_capabilities_check CHECK (
        vc.go_model_capabilities_valid(capabilities)),
    ADD CONSTRAINT provider_model_reasoning_levels_check CHECK (
        vc.go_model_reasoning_levels_valid(reasoning_levels)),
    ADD CONSTRAINT provider_model_generation_params_check CHECK (
        vc.go_model_generation_params_valid(generation_params, reasoning_levels)),
    ADD CONSTRAINT provider_model_pricing_check CHECK (
        vc.go_model_pricing_valid(pricing));

CREATE TABLE vc.model_purpose_binding (
    purpose      text PRIMARY KEY,
    provider_id  text,
    profile_key  text,
    state        text NOT NULL,
    revision     bigint NOT NULL DEFAULT 1,
    updated_by   bigint NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT model_purpose_binding_purpose_check CHECK (
        purpose IN ('FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY',
                    'BACKGROUND_GREETINGS', 'STORY_DIRECTOR',
                    'NPC_DIALOGUE', 'EMBEDDING')),
    CONSTRAINT model_purpose_binding_state_check CHECK (
        state IN ('ENABLED', 'DISABLED')),
    CONSTRAINT model_purpose_binding_ref_check CHECK (
        (provider_id IS NULL) = (profile_key IS NULL)),
    -- Embedding is not one of the three chat protocols; it stays pending
    -- until a dedicated embedding path exists (W08).
    CONSTRAINT model_purpose_binding_embedding_check CHECK (
        purpose <> 'EMBEDDING' OR provider_id IS NULL),
    FOREIGN KEY (provider_id, profile_key)
        REFERENCES vc.provider_model(provider_id, profile_key)
        ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO vc.model_purpose_binding(purpose, state, updated_by)
VALUES ('FOREGROUND_CHAT', 'DISABLED', 0),
       ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 'DISABLED', 0),
       ('BACKGROUND_GREETINGS', 'DISABLED', 0),
       ('STORY_DIRECTOR', 'DISABLED', 0),
       ('NPC_DIALOGUE', 'DISABLED', 0),
       ('EMBEDDING', 'DISABLED', 0);

REVOKE ALL ON TABLE vc.model_purpose_binding
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- Signatures and result shapes change; the V119 definitions are replaced.
DROP FUNCTION vc.go_admin_list_provider_models(bigint);
DROP FUNCTION vc.go_admin_upsert_provider(bigint, text, text, text, text, text, text);
DROP FUNCTION vc.go_admin_upsert_provider_model(bigint, text, text, text, integer, integer, text);
DROP FUNCTION vc.go_admin_delete_provider_models_except(bigint, text, text[]);

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
        out_model_updated_at timestamptz)
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
           m.updated_at
      FROM vc.provider_config p
      LEFT JOIN vc.provider_model m ON m.provider_id = p.provider_id
     ORDER BY p.created_at, p.provider_id, m.priority, m.profile_key;
END;
$$;

-- p_credential_action: KEEP preserves the stored envelope, SET replaces it with
-- p_credential_cipher, CLEAR removes it. p_expected_revision NULL skips the
-- optimistic check (older callers); otherwise it is compared under the row
-- lock. Go calls this twice per snapshot: once DISABLED with the check and no
-- bump, once with the final state and the bump, so a snapshot advances the
-- revision exactly once. Returns the revision after the call.
CREATE FUNCTION vc.go_admin_upsert_provider(
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
    SELECT p.revision, p.credential_cipher
      INTO v_revision, v_cipher
      FROM vc.provider_config p
     WHERE p.provider_id = v_provider_id
       FOR UPDATE;
    v_exists := FOUND;
    IF NOT v_exists THEN
        v_revision := 0;
        IF (SELECT count(*) FROM vc.provider_config) >= 8 THEN
            RAISE EXCEPTION 'go_admin_provider: provider capacity reached';
        END IF;
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
    -- A provider created by the non-bumping preparatory call sits at 0 until
    -- the same transaction's final call bumps it to 1; a single bumping call
    -- creates it at 1 directly.
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

-- The four document parameters are NULL when the caller did not send that
-- object: an existing profile keeps its stored value, a new profile starts
-- empty (unknown capabilities, no params, unknown pricing).
CREATE FUNCTION vc.go_admin_upsert_provider_model(
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
    -- VERIFIED is written only by an explicit verification action. An
    -- administrator may echo a field this same profile already has verified,
    -- but a new profile, a clone or an upgrade from any other status is refused.
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
END;
$$;

-- A snapshot that omits a profile still bound to a purpose is refused; the
-- binding has to be moved first so no purpose is silently unpinned.
CREATE FUNCTION vc.go_admin_delete_provider_models_except(
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
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_admin_normalize_provider_model_priorities(
    p_acting_account_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    WITH ranked AS (
        SELECT m.provider_id, m.profile_key,
               row_number() OVER (
                   ORDER BY CASE WHEN p.state = 'ENABLED' AND m.state = 'ENABLED'
                                 THEN 0 ELSE 1 END,
                            m.priority, m.provider_id, m.profile_key)::integer AS next_priority
          FROM vc.provider_model m
          JOIN vc.provider_config p ON p.provider_id = m.provider_id
    )
    UPDATE vc.provider_model m
       SET priority = r.next_priority
      FROM ranked r
     WHERE m.provider_id = r.provider_id
       AND m.profile_key = r.profile_key
       AND m.priority IS DISTINCT FROM r.next_priority;
END;
$$;

-- Route order entries name profiles: {"providerId","profileKey"}. Go fills
-- profileKey from modelId for callers that predate profiles.
CREATE OR REPLACE FUNCTION vc.go_admin_reorder_provider_models(
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
            OR btrim(e->>'profileKey') = '') THEN
        RAISE EXCEPTION 'go_admin_provider_order: invalid route';
    END IF;
    IF (
        SELECT count(DISTINCT (btrim(e->>'providerId'), btrim(e->>'profileKey')))
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
           AND m.profile_key = btrim(e->>'profileKey')
           AND m.state = 'ENABLED'
         WHERE m.profile_key IS NULL) THEN
        RAISE EXCEPTION 'go_admin_provider_order: route is not enabled';
    END IF;

    WITH desired AS (
        SELECT btrim(e->>'providerId') AS provider_id,
               btrim(e->>'profileKey') AS profile_key,
               ordinality::integer AS priority
          FROM jsonb_array_elements(p_order) WITH ORDINALITY AS x(e, ordinality)
    )
    UPDATE vc.provider_model m
       SET priority = d.priority,
           updated_by = p_acting_account_id,
           updated_at = now()
      FROM desired d
     WHERE m.provider_id = d.provider_id
       AND m.profile_key = d.profile_key;

    PERFORM vc.go_admin_normalize_provider_model_priorities(p_acting_account_id);
END;
$$;

-- The legacy Go route chain tries the primary and one fallback. Two profiles
-- of the same remote model must not become a paid retry of the same model, so
-- each (provider, model_id) contributes only its best-priority profile.
CREATE OR REPLACE FUNCTION vc.go_resolve_model_routes()
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
    SELECT r.provider_id, r.supplier_name, r.protocol, r.base_url,
           r.credential_cipher, r.model_id, r.max_output_tokens, r.priority
      FROM (
          SELECT DISTINCT ON (p.provider_id, m.model_id)
                 p.provider_id, p.display_name AS supplier_name, p.protocol, p.base_url,
                 p.credential_cipher, m.model_id, m.max_output_tokens, m.priority
            FROM vc.provider_config p
            JOIN vc.provider_model m ON m.provider_id = p.provider_id
            JOIN vc.provider_deployment d
              ON d.provider_id = p.provider_id
             AND d.protocol = p.protocol
             AND d.admission_state = 'ADMITTED'
           WHERE p.state = 'ENABLED'
             AND m.state = 'ENABLED'
             AND p.credential_cipher IS NOT NULL
           ORDER BY p.provider_id, m.model_id, m.priority
      ) r
     ORDER BY r.priority, r.provider_id, r.model_id
     LIMIT 2;
$$;

-- Binding rows carry the joined provider/model facts Go needs to derive the
-- purpose status (pending / disabled / unavailable / ready) in one place.
CREATE FUNCTION vc.go_admin_list_purpose_bindings(p_acting_account_id bigint)
    RETURNS TABLE(
        out_purpose text,
        out_provider_id text,
        out_profile_key text,
        out_model_id text,
        out_state text,
        out_revision bigint,
        out_updated_at timestamptz,
        out_provider_state text,
        out_credential_configured boolean,
        out_model_state text,
        out_context_window_tokens integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    RETURN QUERY
    SELECT b.purpose, b.provider_id, b.profile_key, m.model_id, b.state, b.revision,
           b.updated_at, p.state, p.credential_cipher IS NOT NULL, m.state,
           m.context_window_tokens
      FROM vc.model_purpose_binding b
      LEFT JOIN vc.provider_config p ON p.provider_id = b.provider_id
      LEFT JOIN vc.provider_model m
        ON m.provider_id = b.provider_id AND m.profile_key = b.profile_key
     ORDER BY b.purpose;
END;
$$;

CREATE FUNCTION vc.go_admin_upsert_purpose_binding(
    p_acting_account_id bigint,
    p_purpose text,
    p_provider_id text,
    p_profile_key text,
    p_state text,
    p_expected_revision bigint)
    RETURNS TABLE(
        out_purpose text,
        out_provider_id text,
        out_profile_key text,
        out_model_id text,
        out_state text,
        out_revision bigint,
        out_updated_at timestamptz,
        out_provider_state text,
        out_credential_configured boolean,
        out_model_state text,
        out_context_window_tokens integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_purpose text := btrim(p_purpose);
    v_provider_id text := NULLIF(btrim(p_provider_id), '');
    v_profile_key text := NULLIF(btrim(p_profile_key), '');
    v_revision bigint;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    IF v_purpose IS NULL OR v_purpose NOT IN (
            'FOREGROUND_CHAT', 'MEMORY_EXTRACTION_DEDUP_SUMMARY', 'BACKGROUND_GREETINGS',
            'STORY_DIRECTOR', 'NPC_DIALOGUE', 'EMBEDDING') THEN
        RAISE EXCEPTION 'go_admin_purpose: purpose not found';
    END IF;
    IF p_state IS NULL OR p_state NOT IN ('ENABLED', 'DISABLED') THEN
        RAISE EXCEPTION 'go_admin_purpose: invalid state';
    END IF;
    IF (v_provider_id IS NULL) <> (v_profile_key IS NULL) THEN
        RAISE EXCEPTION 'go_admin_purpose: invalid profile reference';
    END IF;
    IF v_purpose = 'EMBEDDING' AND v_provider_id IS NOT NULL THEN
        RAISE EXCEPTION 'go_admin_purpose: embedding cannot bind a chat-protocol profile';
    END IF;
    IF v_provider_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM vc.provider_model m
         WHERE m.provider_id = v_provider_id AND m.profile_key = v_profile_key) THEN
        RAISE EXCEPTION 'go_admin_purpose: profile not found';
    END IF;

    SELECT b.revision INTO v_revision
      FROM vc.model_purpose_binding b
     WHERE b.purpose = v_purpose
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_admin_purpose: purpose not found';
    END IF;
    IF p_expected_revision IS NOT NULL AND p_expected_revision <> v_revision THEN
        RAISE EXCEPTION 'go_admin_purpose: revision conflict (current %)', v_revision;
    END IF;

    UPDATE vc.model_purpose_binding b
       SET provider_id = v_provider_id,
           profile_key = v_profile_key,
           state = p_state,
           revision = v_revision + 1,
           updated_by = p_acting_account_id,
           updated_at = now()
     WHERE b.purpose = v_purpose;

    RETURN QUERY
    SELECT l.out_purpose, l.out_provider_id, l.out_profile_key, l.out_model_id, l.out_state,
           l.out_revision, l.out_updated_at, l.out_provider_state,
           l.out_credential_configured, l.out_model_state, l.out_context_window_tokens
      FROM vc.go_admin_list_purpose_bindings(p_acting_account_id) l
     WHERE l.out_purpose = v_purpose;
END;
$$;

-- Service-channel resolution for the SillyTavern server plugin. Go has already
-- authenticated the service identity; this asserts the owner account the
-- plugin acts for is ACTIVE and returns the live binding together with the
-- credential envelope, which Go decrypts in process memory only. It reads the
-- current rows every time, so disabling or clearing a key affects the next
-- request immediately.
CREATE FUNCTION vc.go_service_resolve_purpose(
    p_owner_account_id bigint,
    p_purpose text)
    RETURNS TABLE(
        out_purpose text,
        out_binding_state text,
        out_binding_revision bigint,
        out_provider_id text,
        out_provider_display_name text,
        out_protocol text,
        out_base_url text,
        out_credential_cipher text,
        out_provider_state text,
        out_provider_revision bigint,
        out_profile_key text,
        out_model_id text,
        out_model_display_name text,
        out_context_window_tokens integer,
        out_max_output_tokens integer,
        out_model_state text,
        out_capabilities jsonb,
        out_reasoning_levels text[],
        out_generation_params jsonb,
        out_pricing jsonb)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_account_id IS NULL OR p_owner_account_id <= 0
       OR NOT EXISTS (
           SELECT 1
             FROM vc.identity_account a
            WHERE a.id = p_owner_account_id
              AND a.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    RETURN QUERY
    SELECT b.purpose, b.state, b.revision,
           p.provider_id, p.display_name, p.protocol, p.base_url,
           p.credential_cipher, p.state, p.revision,
           m.profile_key, m.model_id, m.display_name,
           m.context_window_tokens, m.max_output_tokens, m.state,
           m.capabilities, m.reasoning_levels, m.generation_params, m.pricing
      FROM vc.model_purpose_binding b
      LEFT JOIN vc.provider_config p ON p.provider_id = b.provider_id
      LEFT JOIN vc.provider_model m
        ON m.provider_id = b.provider_id AND m.profile_key = b.profile_key
     WHERE b.purpose = btrim(p_purpose);
END;
$$;

REVOKE ALL ON FUNCTION vc.go_admin_list_provider_models(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_upsert_provider(
    bigint, text, text, text, text, text, text, text, bigint, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_upsert_provider_model(
    bigint, text, text, text, text, integer, integer, text, jsonb, text[], jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_delete_provider_models_except(bigint, text, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_list_purpose_bindings(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_upsert_purpose_binding(
    bigint, text, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_service_resolve_purpose(bigint, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.go_admin_list_provider_models(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_upsert_provider(
    bigint, text, text, text, text, text, text, text, bigint, boolean) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_upsert_provider_model(
    bigint, text, text, text, text, integer, integer, text, jsonb, text[], jsonb, jsonb) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_delete_provider_models_except(bigint, text, text[]) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_list_purpose_bindings(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_upsert_purpose_binding(
    bigint, text, text, text, text, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_service_resolve_purpose(bigint, text) TO vc_api;
