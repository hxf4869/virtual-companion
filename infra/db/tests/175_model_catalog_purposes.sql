-- 171_model_catalog_purposes: V2-W03 model catalog. Credential drafts and
-- explicit clear, provider revision conflicts, profiles ("save as" keeps the
-- remote model id), purpose bindings (embedding stays pending, a bound
-- profile cannot be dropped, purposes are independent), service-channel
-- resolution with an ACTIVE owner, and least privilege.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_model, vc.provider_config, vc.provider_deployment,
         vc.identity_auth_event, vc.identity_opaque_session,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;
-- TRUNCATE CASCADE removed the seeded binding rows; restore them.
INSERT INTO vc.model_purpose_binding(purpose, state, updated_by)
VALUES ('FOREGROUND_CHAT', 'DISABLED', 0), ('MEMORY_EXTRACTION_DEDUP_SUMMARY', 'DISABLED', 0),
       ('BACKGROUND_GREETINGS', 'DISABLED', 0), ('STORY_DIRECTOR', 'DISABLED', 0),
       ('NPC_DIALOGUE', 'DISABLED', 0), ('EMBEDDING', 'DISABLED', 0)
ON CONFLICT (purpose) DO UPDATE
   SET provider_id = NULL, profile_key = NULL, state = 'DISABLED';

INSERT INTO vc.vc_user(id, display_name)
VALUES (9001, 'provider admin'), (9002, 'owner'), (9003, 'disabled owner');
INSERT INTO vc.identity_account(
    id, username, password_hash, role, status, display_name)
VALUES
    (9001, 'catalog-admin', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'ADMIN', 'ACTIVE', 'provider admin'),
    (9002, 'catalog-owner', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'USER', 'ACTIVE', 'owner'),
    (9003, 'catalog-disabled', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'USER', 'DISABLED', 'disabled owner');

SET ROLE vc_api;
DO $$
DECLARE
    n integer;
    v_revision bigint;
    v_cipher text;
    v_caps jsonb;
    v_text text;
    v_state text;
BEGIN
    -- A credential-less draft is allowed only while DISABLED.
    v_revision := vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'KEEP', NULL, 'DISABLED', NULL, false);
    IF v_revision <> 0 THEN RAISE EXCEPTION 'prepared draft revision %', v_revision; END IF;
    PERFORM vc.go_admin_upsert_provider_model(
        9001, 'draft', 'm', 'm', 'M', 32768, 2048, 'ENABLED', NULL, NULL, NULL, NULL);
    BEGIN
        PERFORM vc.go_admin_upsert_provider(
            9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
            'KEEP', NULL, 'ENABLED', NULL, true);
        RAISE EXCEPTION 'enabling a draft without a credential must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%requires a credential%' THEN RAISE; END IF;
    END;
    IF EXISTS (SELECT 1 FROM vc.go_admin_list_provider_models(9001)
                WHERE out_provider_id = 'draft' AND out_credential_configured) THEN
        RAISE EXCEPTION 'draft must report no credential';
    END IF;

    -- SET / KEEP / CLEAR are distinct; CLEAR cannot leave the provider ENABLED.
    v_revision := vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'SET', 'enc2:k1', 'ENABLED', NULL, true);
    IF v_revision <> 1 THEN RAISE EXCEPTION 'set revision %', v_revision; END IF;
    BEGIN
        PERFORM vc.go_admin_upsert_provider(
            9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
            'CLEAR', NULL, 'ENABLED', NULL, true);
        RAISE EXCEPTION 'clearing while ENABLED must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%requires a credential%' THEN RAISE; END IF;
    END;
    v_revision := vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'KEEP', NULL, 'ENABLED', NULL, true);
    SELECT out_credential_cipher INTO v_cipher
      FROM vc.go_admin_get_provider_credential(9001, 'draft');
    IF v_cipher IS DISTINCT FROM 'enc2:k1' THEN
        RAISE EXCEPTION 'KEEP must preserve the envelope, got %', v_cipher;
    END IF;
    v_revision := vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'CLEAR', NULL, 'DISABLED', NULL, true);
    IF v_revision <> 3 THEN RAISE EXCEPTION 'clear revision %', v_revision; END IF;
    SELECT out_credential_cipher INTO v_cipher
      FROM vc.go_admin_get_provider_credential(9001, 'draft');
    IF v_cipher IS NOT NULL THEN
        RAISE EXCEPTION 'CLEAR must remove the envelope';
    END IF;

    -- Optimistic revision check runs under the row lock.
    BEGIN
        PERFORM vc.go_admin_upsert_provider(
            9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
            'KEEP', NULL, 'DISABLED', 1, false);
        RAISE EXCEPTION 'stale revision must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%revision conflict (current 3)%' THEN RAISE; END IF;
    END;
    v_revision := vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'KEEP', NULL, 'DISABLED', 3, true);
    IF v_revision <> 4 THEN RAISE EXCEPTION 'matched revision %', v_revision; END IF;

    -- "Save as new": same remote model id, distinct profile key, own documents.
    PERFORM vc.go_admin_upsert_provider_model(
        9001, 'draft', 'm@memory', 'm', 'M for memory', 32768, 1024, 'ENABLED',
        '{"toolCalls":"DECLARED"}'::jsonb, ARRAY['low', 'high']::text[],
        '{"temperature":0.2,"reasoningEffort":"low"}'::jsonb,
        '{"currency":"USD","inputPerMillionTokens":1.5}'::jsonb);
    SELECT count(*) INTO n FROM vc.go_admin_list_provider_models(9001)
     WHERE out_provider_id = 'draft' AND out_model_id = 'm';
    IF n <> 2 THEN RAISE EXCEPTION 'two profiles expected for model m, got %', n; END IF;
    BEGIN
        PERFORM vc.go_admin_upsert_provider_model(
            9001, 'draft', 'm@memory', 'm', 'M for memory', 32768, 1024, 'ENABLED',
            NULL, NULL, '{"reasoningEffort":"medium"}'::jsonb, NULL);
        RAISE EXCEPTION 'unknown reasoning effort must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%unsupported generation parameter%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.go_admin_upsert_provider_model(
            9001, 'draft', 'm@memory', 'm', 'M for memory', 32768, 1024, 'ENABLED',
            NULL, NULL, NULL, '{"outputPerMillionTokens":3}'::jsonb);
        RAISE EXCEPTION 'price without currency must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%invalid pricing%' THEN RAISE; END IF;
    END;
    -- NULL documents keep what an older caller never sent.
    PERFORM vc.go_admin_upsert_provider_model(
        9001, 'draft', 'm@memory', 'm', 'M for memory', 32768, 1024, 'ENABLED',
        NULL, NULL, NULL, NULL);
    SELECT out_capabilities INTO v_caps FROM vc.go_admin_list_provider_models(9001)
     WHERE out_provider_id = 'draft' AND out_profile_key = 'm@memory';
    IF v_caps->>'toolCalls' IS DISTINCT FROM 'DECLARED' THEN
        RAISE EXCEPTION 'omitted capabilities were not preserved: %', v_caps;
    END IF;

    -- Purpose bindings.
    PERFORM vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'SET', 'enc2:k2', 'ENABLED', NULL, true);
    -- Two enabled profiles of one remote model give the legacy chain one route,
    -- never a paid retry of the same model.
    SELECT count(*) INTO n FROM vc.go_resolve_model_routes() WHERE out_model_id = 'm';
    IF n <> 1 THEN RAISE EXCEPTION 'legacy chain must dedupe profiles, got %', n; END IF;
    SELECT out_revision INTO v_revision
      FROM vc.go_admin_upsert_purpose_binding(
          9001, 'FOREGROUND_CHAT', 'draft', 'm@memory', 'ENABLED', NULL);
    IF v_revision <> 2 THEN RAISE EXCEPTION 'binding revision %', v_revision; END IF;
    BEGIN
        PERFORM vc.go_admin_upsert_purpose_binding(
            9001, 'FOREGROUND_CHAT', 'draft', 'm', 'ENABLED', 1);
        RAISE EXCEPTION 'stale binding revision must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%revision conflict (current 2)%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.go_admin_upsert_purpose_binding(
            9001, 'EMBEDDING', 'draft', 'm', 'ENABLED', NULL);
        RAISE EXCEPTION 'embedding bound to a chat profile must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%embedding cannot bind%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.go_admin_upsert_purpose_binding(
            9001, 'NPC_DIALOGUE', 'draft', 'missing', 'ENABLED', NULL);
        RAISE EXCEPTION 'unknown profile must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%profile not found%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.go_admin_delete_provider_models_except(
            9001, 'draft', ARRAY['m']::text[]);
        RAISE EXCEPTION 'dropping a bound profile must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%profile in use: FOREGROUND_CHAT%' THEN RAISE; END IF;
    END;
    -- Switching the foreground binding leaves an independently pinned purpose alone.
    PERFORM vc.go_admin_upsert_purpose_binding(
        9001, 'NPC_DIALOGUE', 'draft', 'm', 'ENABLED', NULL);
    PERFORM vc.go_admin_upsert_purpose_binding(
        9001, 'FOREGROUND_CHAT', 'draft', 'm', 'DISABLED', 2);
    SELECT out_profile_key || ':' || out_revision::text INTO v_text
      FROM vc.go_admin_list_purpose_bindings(9001) WHERE out_purpose = 'NPC_DIALOGUE';
    IF v_text IS DISTINCT FROM 'm:2' THEN
        RAISE EXCEPTION 'npc binding changed unexpectedly: %', v_text;
    END IF;
    SELECT count(*) INTO n FROM vc.go_admin_list_purpose_bindings(9001);
    IF n <> 6 THEN RAISE EXCEPTION 'six purposes expected, got %', n; END IF;

    -- Service-channel resolution: live envelope for an ACTIVE owner only.
    SELECT out_credential_cipher INTO v_cipher
      FROM vc.go_service_resolve_purpose(9002, 'NPC_DIALOGUE');
    IF v_cipher IS DISTINCT FROM 'enc2:k2' THEN
        RAISE EXCEPTION 'service resolve envelope mismatch';
    END IF;
    BEGIN
        PERFORM vc.go_service_resolve_purpose(9003, 'NPC_DIALOGUE');
        RAISE EXCEPTION 'disabled owner must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an active account%' THEN RAISE; END IF;
    END;
    -- Clearing the key (provider disabled) is visible to the next resolution.
    PERFORM vc.go_admin_upsert_provider(
        9001, 'draft', 'Draft', 'OPENAI_CHAT_COMPLETIONS', 'https://chat.example/v1',
        'CLEAR', NULL, 'DISABLED', NULL, true);
    SELECT out_credential_cipher, out_provider_state INTO v_cipher, v_state
      FROM vc.go_service_resolve_purpose(9002, 'NPC_DIALOGUE');
    IF v_cipher IS NOT NULL OR v_state <> 'DISABLED' THEN
        RAISE EXCEPTION 'cleared credential still resolvable';
    END IF;

    BEGIN
        PERFORM count(*) FROM vc.model_purpose_binding;
        RAISE EXCEPTION 'vc_api unexpectedly read model_purpose_binding directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
RESET ROLE;

-- VERIFIED is written by a verification action (simulated here as the owner
-- of the table); an administrator may echo it for the same profile field but
-- cannot upgrade another field or clone it onto a new profile.
UPDATE vc.provider_model
   SET capabilities = capabilities || '{"toolCalls":"VERIFIED"}'::jsonb
 WHERE provider_id = 'draft' AND profile_key = 'm@memory';

SET ROLE vc_api;
DO $$
DECLARE
    v_caps jsonb;
BEGIN
    PERFORM vc.go_admin_upsert_provider_model(
        9001, 'draft', 'm@memory', 'm', 'M for memory', 32768, 1024, 'ENABLED',
        '{"toolCalls":"VERIFIED","pdfInput":"DECLARED"}'::jsonb, NULL, NULL, NULL);
    SELECT out_capabilities INTO v_caps FROM vc.go_admin_list_provider_models(9001)
     WHERE out_provider_id = 'draft' AND out_profile_key = 'm@memory';
    IF v_caps->>'toolCalls' IS DISTINCT FROM 'VERIFIED' OR v_caps->>'pdfInput' IS DISTINCT FROM 'DECLARED' THEN
        RAISE EXCEPTION 'echoed VERIFIED must be retained while editing another field: %', v_caps;
    END IF;
    BEGIN
        PERFORM vc.go_admin_upsert_provider_model(
            9001, 'draft', 'm', 'm', 'M', 32768, 2048, 'ENABLED',
            '{"toolCalls":"VERIFIED"}'::jsonb, NULL, NULL, NULL);
        RAISE EXCEPTION 'upgrade to VERIFIED must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an admin input%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.go_admin_upsert_provider_model(
            9001, 'draft', 'm@clone', 'm', 'M clone', 32768, 1024, 'ENABLED',
            '{"toolCalls":"VERIFIED"}'::jsonb, NULL, NULL, NULL);
        RAISE EXCEPTION 'clone with VERIFIED must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an admin input%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;
