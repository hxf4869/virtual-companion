-- T1: only an active ADMIN, through go_admin_mark_model_tool_calls_verified,
-- can record toolCalls=VERIFIED. vc_api cannot read the table. vc_worker
-- cannot execute the function. Changing the base URL downgrades VERIFIED,
-- including a historical row that has no verification metadata.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (29501, 't1 admin'), (29502, 't1 user')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (29501, 't1-295-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin'),
    (29502, 't1-295-user', 'synthetic', 'USER', 'ACTIVE', 'user')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE';

DELETE FROM vc.provider_model WHERE provider_id = 'p295';
DELETE FROM vc.provider_deployment WHERE provider_id = 'p295';
DELETE FROM vc.provider_config WHERE provider_id = 'p295';

SELECT vc.go_admin_upsert_provider(
    29501, 'p295', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://probe.example/v1',
    'SET', 'enc2:synthetic', 'DISABLED', NULL, false);
SELECT vc.go_admin_upsert_provider_model(
    29501, 'p295', 'm@chat', 'remote-a', 'Probe', NULL, 128, 'ENABLED',
    '{}'::jsonb, '{}'::text[], '{}'::jsonb, '{}'::jsonb);
SELECT vc.go_admin_upsert_provider(
    29501, 'p295', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://probe.example/v1',
    'KEEP', NULL, 'ENABLED', NULL, true);

CREATE TEMP TABLE t295_revision(revision bigint);
INSERT INTO t295_revision
SELECT revision FROM vc.provider_config WHERE provider_id = 'p295';
GRANT SELECT ON t295_revision TO vc_api;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM 1 FROM vc.provider_model;
    RAISE EXCEPTION 'vc_api read provider_model';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;

DO $$
BEGIN
    PERFORM 1 FROM vc.go_admin_mark_model_tool_calls_verified(
        29502, 'p295', 'm@chat', 'OPENAI_CHAT_COMPLETIONS', 'https://probe.example/v1', 'remote-a', 0);
    RAISE EXCEPTION 'user marked verified';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%user marked verified%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
        RAISE EXCEPTION 'user denial %', SQLERRM;
    END IF;
END $$;

DO $$
DECLARE
    v_at timestamptz;
    v_protocol text;
    v_calls text;
    v_revision bigint;
BEGIN
    SELECT revision INTO v_revision FROM t295_revision;
    SELECT out_verified_at, out_protocol
      INTO v_at, v_protocol
      FROM vc.go_admin_mark_model_tool_calls_verified(
          29501, 'p295', 'm@chat', 'OPENAI_CHAT_COMPLETIONS', 'https://probe.example/v1', 'remote-a', v_revision);
    IF v_at IS NULL OR v_protocol IS DISTINCT FROM 'OPENAI_CHAT_COMPLETIONS' THEN
        RAISE EXCEPTION 'admin mark % %', v_at, v_protocol;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_calls text;
    v_protocol text;
    v_base text;
    v_model text;
    v_present boolean;
BEGIN
    SELECT capabilities->>'toolCalls', tool_calls_verified_protocol,
           tool_calls_verified_base_url, tool_calls_verified_model_id,
           tool_calls_verified_at IS NOT NULL
      INTO v_calls, v_protocol, v_base, v_model, v_present
      FROM vc.provider_model
     WHERE provider_id = 'p295' AND profile_key = 'm@chat';
    IF v_calls IS DISTINCT FROM 'VERIFIED' OR v_protocol IS DISTINCT FROM 'OPENAI_CHAT_COMPLETIONS'
       OR v_base IS DISTINCT FROM 'https://probe.example/v1'
       OR v_model IS DISTINCT FROM 'remote-a' OR NOT v_present THEN
        RAISE EXCEPTION 'record % % % % %', v_calls, v_protocol, v_base, v_model, v_present;
    END IF;
END $$;

-- Echoing VERIFIED while the base URL changes downgrades and clears the record.
-- The binding flag is transaction-local, so the save has to be one transaction,
-- matching SaveProviderConfig.
BEGIN;
SELECT vc.go_admin_upsert_provider(
    29501, 'p295', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://moved.example/v1',
    'KEEP', NULL, 'DISABLED', NULL, false);
SELECT vc.go_admin_upsert_provider_model(
    29501, 'p295', 'm@chat', 'remote-a', 'Probe', NULL, 128, 'ENABLED',
    '{"toolCalls":"VERIFIED"}'::jsonb, NULL, NULL, NULL);
SELECT vc.go_admin_upsert_provider(
    29501, 'p295', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://moved.example/v1',
    'KEEP', NULL, 'ENABLED', NULL, true);
COMMIT;

DO $$
DECLARE
    v_calls text;
    v_present boolean;
BEGIN
    SELECT capabilities->>'toolCalls', tool_calls_verified_at IS NOT NULL
      INTO v_calls, v_present
      FROM vc.provider_model
     WHERE provider_id = 'p295' AND profile_key = 'm@chat';
    IF v_calls IS DISTINCT FROM 'DECLARED' OR v_present THEN
        RAISE EXCEPTION 'base url downgrade % present=%', v_calls, v_present;
    END IF;
END $$;

-- A historical VERIFIED row has no metadata. The next base URL change still downgrades it.
UPDATE vc.provider_model
   SET capabilities = jsonb_set(capabilities, '{toolCalls}', '"VERIFIED"', true)
 WHERE provider_id = 'p295' AND profile_key = 'm@chat';
BEGIN;
SELECT vc.go_admin_upsert_provider(
    29501, 'p295', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://third.example/v1',
    'KEEP', NULL, 'DISABLED', NULL, false);
SELECT vc.go_admin_upsert_provider_model(
    29501, 'p295', 'm@chat', 'remote-a', 'Probe', NULL, 128, 'ENABLED',
    '{"toolCalls":"VERIFIED"}'::jsonb, NULL, NULL, NULL);
COMMIT;

DO $$
DECLARE v_calls text;
BEGIN
    SELECT capabilities->>'toolCalls' INTO v_calls
      FROM vc.provider_model
     WHERE provider_id = 'p295' AND profile_key = 'm@chat';
    IF v_calls IS DISTINCT FROM 'DECLARED' THEN
        RAISE EXCEPTION 'historical downgrade %', v_calls;
    END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM 1 FROM vc.go_admin_mark_model_tool_calls_verified(
        29501, 'p295', 'm@chat', 'OPENAI_CHAT_COMPLETIONS', 'https://third.example/v1', 'remote-a', 0);
    RAISE EXCEPTION 'worker executed mark';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
COMMIT;
RESET ROLE;

DROP TABLE IF EXISTS t295_revision;
DELETE FROM vc.provider_model WHERE provider_id = 'p295';
DELETE FROM vc.provider_deployment WHERE provider_id = 'p295';
DELETE FROM vc.provider_config WHERE provider_id = 'p295';
