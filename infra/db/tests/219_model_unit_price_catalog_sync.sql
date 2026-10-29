-- 219: catalog save is the only runtime path that writes vc.model_unit_price.
-- V2-W11 files 225-229 are already used, so this check takes the free
-- number beside that range. Runtime roles cannot execute the sync function
-- or write the price table. An active ADMIN upsert publishes USD per 1K
-- (page prices are per million), a repeat does not bump the version, and a
-- non-USD price clears the active row. A non-admin call writes nothing.

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_role text;
BEGIN
    FOREACH v_role IN ARRAY ARRAY['vc_api', 'vc_worker', 'vc_job_coordinator', 'vc_dispatcher']
    LOOP
        IF has_function_privilege(v_role, 'vc.sync_provider_model_ledger(text,boolean)', 'EXECUTE') THEN
            RAISE EXCEPTION '% must not execute sync_provider_model_ledger', v_role;
        END IF;
        IF has_function_privilege(v_role, 'vc.profile_ledger_price_status(text,text,text,jsonb)', 'EXECUTE') THEN
            RAISE EXCEPTION '% must not execute profile_ledger_price_status', v_role;
        END IF;
        IF has_table_privilege(v_role, 'vc.model_unit_price', 'INSERT')
           OR has_table_privilege(v_role, 'vc.model_unit_price', 'UPDATE')
           OR has_table_privilege(v_role, 'vc.model_unit_price', 'DELETE') THEN
            RAISE EXCEPTION '% must not write model_unit_price', v_role;
        END IF;
    END LOOP;
    IF has_function_privilege('public', 'vc.sync_provider_model_ledger(text,boolean)', 'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC must not execute sync_provider_model_ledger';
    END IF;
END $$;

BEGIN;
INSERT INTO vc.vc_user(id, display_name)
VALUES (21901, 'ledger admin'), (21902, 'ledger user');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES
    (21901, 'ledger-admin', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'ADMIN', 'ACTIVE', 'ledger admin'),
    (21902, 'ledger-user', '$2a$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
     'USER', 'ACTIVE', 'ledger user');

UPDATE vc.model_purpose_binding
   SET provider_id = NULL, profile_key = NULL, state = 'DISABLED';
DELETE FROM vc.provider_model;
DELETE FROM vc.provider_deployment;
DELETE FROM vc.provider_config;

SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        INSERT INTO vc.model_unit_price(
            provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
        VALUES ('ledger', 'chat', 1, 0.001, 0.002);
        RAISE EXCEPTION 'direct INSERT on model_unit_price must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE vc.model_unit_price SET active = false WHERE provider_id = 'ledger';
        RAISE EXCEPTION 'direct UPDATE on model_unit_price must be denied';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM vc.go_admin_upsert_provider(
            21902, 'ledger', 'Ledger', 'OPENAI_CHAT_COMPLETIONS',
            'https://ledger.example/v1', 'KEEP', NULL, 'DISABLED', NULL, true);
        RAISE EXCEPTION 'non-admin provider write must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must fail%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;

    PERFORM vc.go_admin_upsert_provider(
        21901, 'ledger', 'Ledger', 'OPENAI_CHAT_COMPLETIONS',
        'https://ledger.example/v1', 'KEEP', NULL, 'DISABLED', NULL, true);
    PERFORM vc.go_admin_upsert_provider_model(
        21901, 'ledger', 'chat', 'chat', 'Chat', 32768, 2048, 'ENABLED',
        NULL, NULL, NULL,
        '{"currency":"USD","inputPerMillionTokens":1.5,"outputPerMillionTokens":3}'::jsonb);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_snap text;
    v_status text;
BEGIN
    IF EXISTS (SELECT 1 FROM vc.provider_config WHERE provider_id = 'ledger' AND updated_by = 21902) THEN
        RAISE EXCEPTION 'non-admin call created a provider';
    END IF;
    SELECT coalesce(string_agg(
               price_version::text || ':' || input_usd_per_1k::text || ':' ||
               output_usd_per_1k::text || ':' || active::text, ',' ORDER BY price_version), '')
      INTO v_snap
      FROM vc.model_unit_price
     WHERE provider_id = 'ledger' AND model_id = 'chat';
    IF v_snap IS DISTINCT FROM '1:0.0015:0.003:true' THEN
        RAISE EXCEPTION 'admin USD upsert ledger %', v_snap;
    END IF;
    SELECT out_ledger_price INTO v_status
      FROM vc.go_admin_list_provider_models(21901)
     WHERE out_provider_id = 'ledger' AND out_profile_key = 'chat';
    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
        RAISE EXCEPTION 'USD ledgerPrice %', v_status;
    END IF;
END $$;

SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.go_admin_upsert_provider_model(
        21901, 'ledger', 'chat', 'chat', 'Chat', 32768, 2048, 'ENABLED',
        NULL, NULL, NULL,
        '{"currency":"USD","inputPerMillionTokens":1.5,"outputPerMillionTokens":3}'::jsonb);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_n integer;
BEGIN
    SELECT count(*) INTO v_n FROM vc.model_unit_price
     WHERE provider_id = 'ledger' AND model_id = 'chat';
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'same USD price bumped the ledger to % rows', v_n;
    END IF;
END $$;

SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.go_admin_upsert_provider_model(
        21901, 'ledger', 'chat', 'chat', 'Chat', 32768, 2048, 'ENABLED',
        NULL, NULL, NULL,
        '{"currency":"CNY","inputPerMillionTokens":1.5,"outputPerMillionTokens":3}'::jsonb);
END $$;
RESET ROLE;

DO $$
DECLARE
    v_active integer;
    v_status text;
BEGIN
    SELECT count(*) INTO v_active FROM vc.model_unit_price
     WHERE provider_id = 'ledger' AND model_id = 'chat' AND active;
    IF v_active <> 0 THEN
        RAISE EXCEPTION 'CNY left % active prices', v_active;
    END IF;
    SELECT out_ledger_price INTO v_status
      FROM vc.go_admin_list_provider_models(21901)
     WHERE out_provider_id = 'ledger' AND out_profile_key = 'chat';
    IF v_status IS DISTINCT FROM 'UNSUPPORTED_CURRENCY' THEN
        RAISE EXCEPTION 'CNY ledgerPrice %', v_status;
    END IF;
END $$;
ROLLBACK;
RESET ROLE;
