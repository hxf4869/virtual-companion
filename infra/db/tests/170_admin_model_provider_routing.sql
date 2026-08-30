-- 170_admin_model_provider_routing: G12 administrator provider/model chain.
-- Covers ADMIN authorization, secret-free list, deployment admission sync,
-- deterministic global reorder, full-snapshot removal and least privilege.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_model, vc.provider_config, vc.provider_deployment,
         vc.identity_auth_event, vc.identity_opaque_session,
         vc.identity_refresh_token, vc.identity_account, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name)
VALUES (9001, 'provider admin'), (9002, 'ordinary user');
INSERT INTO vc.identity_account(
    id, username, password_hash, role, status, display_name)
VALUES
    (9001, 'provider-admin', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'ADMIN', 'ACTIVE', 'provider admin'),
    (9002, 'provider-user', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'USER', 'ACTIVE', 'ordinary user');

SET ROLE vc_api;
DO $$
DECLARE
    n integer;
    v_order text;
    v_cipher text;
BEGIN
    BEGIN
        PERFORM vc.go_admin_upsert_provider(
            9001, 'acme', 'Acme', 'OPENAI_RESPONSES',
            'https://gateway.example/v1', 'enc2:test-envelope', 'ENABLED');
        RAISE EXCEPTION 'provider without an enabled model must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%provider without an enabled model must fail%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%requires an enabled model%' THEN RAISE; END IF;
    END;

    PERFORM vc.go_admin_upsert_provider(
        9001, 'acme', 'Acme', 'OPENAI_RESPONSES',
        'https://gateway.example/v1', 'enc2:test-envelope', 'DISABLED');
    PERFORM vc.go_admin_upsert_provider_model(
        9001, 'acme', 'model-a', 'Model A', 256000, 32000, 'ENABLED');
    PERFORM vc.go_admin_upsert_provider_model(
        9001, 'acme', 'model-b', 'Model B', NULL, 4096, 'ENABLED');
    PERFORM vc.go_admin_normalize_provider_model_priorities(9001);
    PERFORM vc.go_admin_upsert_provider(
        9001, 'acme', 'Acme', 'OPENAI_RESPONSES',
        'https://gateway.example/v1', NULL, 'ENABLED');

    IF NOT EXISTS (
        SELECT 1 FROM vc.admin_provider_registry(9001)
         WHERE out_provider_id = 'acme'
           AND out_protocol = 'OPENAI_RESPONSES'
           AND out_admission_state = 'ADMITTED') THEN
        RAISE EXCEPTION 'provider deployment admission was not synchronized';
    END IF;
    SELECT count(*) INTO n
      FROM vc.go_admin_list_provider_models(9001)
     WHERE out_provider_id = 'acme' AND out_credential_configured;
    IF n <> 2 THEN
        RAISE EXCEPTION 'secret-free provider list must contain both models, got %', n;
    END IF;
    SELECT out_credential_cipher INTO v_cipher
      FROM vc.go_admin_get_provider_credential(9001, 'acme');
    IF v_cipher IS DISTINCT FROM 'enc2:test-envelope' THEN
        RAISE EXCEPTION 'credential envelope lookup mismatch';
    END IF;

    SELECT string_agg(out_model_id, ',' ORDER BY out_priority)
      INTO v_order FROM vc.go_resolve_model_routes();
    IF v_order IS DISTINCT FROM 'model-a,model-b' THEN
        RAISE EXCEPTION 'initial route order %', v_order;
    END IF;
    PERFORM vc.go_admin_reorder_provider_models(
        9001,
        '[{"providerId":"acme","modelId":"model-b"},'
        '{"providerId":"acme","modelId":"model-a"}]'::jsonb);
    SELECT string_agg(out_model_id, ',' ORDER BY out_priority)
      INTO v_order FROM vc.go_resolve_model_routes();
    IF v_order IS DISTINCT FROM 'model-b,model-a' THEN
        RAISE EXCEPTION 'reordered route chain %', v_order;
    END IF;

    -- A full snapshot that omits model-a removes it from configuration; the
    -- remaining disabled/enabled distinction is reserved for explicit state.
    PERFORM vc.go_admin_delete_provider_models_except(
        9001, 'acme', ARRAY['model-b']::text[]);
    PERFORM vc.go_admin_normalize_provider_model_priorities(9001);
    SELECT count(*) INTO n FROM vc.go_admin_list_provider_models(9001)
     WHERE out_provider_id = 'acme' AND out_model_id = 'model-a';
    IF n <> 0 THEN
        RAISE EXCEPTION 'omitted model returned after full-snapshot removal';
    END IF;

    BEGIN
        PERFORM vc.go_admin_list_provider_models(9002);
        RAISE EXCEPTION 'non-admin unexpectedly listed providers';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%non-admin unexpectedly listed providers%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;

    BEGIN
        PERFORM count(*) FROM vc.provider_config;
        RAISE EXCEPTION 'vc_api unexpectedly read provider_config directly';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
RESET ROLE;
