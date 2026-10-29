-- A mark written with the probed identity fails closed when that identity
-- changed during the probe. The capability bits stay DECLARED.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (29701, 't297 admin')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (29701, 't297-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'ACTIVE';

DELETE FROM vc.provider_model WHERE provider_id = 'p297';
DELETE FROM vc.provider_deployment WHERE provider_id = 'p297';
DELETE FROM vc.provider_config WHERE provider_id = 'p297';

SELECT vc.go_admin_upsert_provider(
    29701, 'p297', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://probe.example/v1',
    'SET', 'enc2:synthetic', 'DISABLED', NULL, false);
SELECT vc.go_admin_upsert_provider_model(
    29701, 'p297', 'm@chat', 'remote-a', 'Probe', NULL, 128, 'ENABLED',
    '{"toolCalls":"DECLARED"}'::jsonb, '{}'::text[], '{}'::jsonb, '{}'::jsonb);
SELECT vc.go_admin_upsert_provider(
    29701, 'p297', 'Probe', 'OPENAI_CHAT_COMPLETIONS', 'https://probe.example/v1',
    'KEEP', NULL, 'ENABLED', NULL, true);

DO $$
DECLARE
    v_protocol text;
    v_base text;
    v_model text;
    v_revision bigint;
    v_calls text;
BEGIN
    SELECT p.protocol, p.base_url, m.model_id, p.revision
      INTO v_protocol, v_base, v_model, v_revision
      FROM vc.provider_config p
      JOIN vc.provider_model m ON m.provider_id = p.provider_id
     WHERE p.provider_id = 'p297' AND m.profile_key = 'm@chat';
    PERFORM vc.go_admin_upsert_provider_model(
        29701, 'p297', 'm@chat', 'remote-b', 'Probe', NULL, 128, 'ENABLED',
        '{"toolCalls":"DECLARED"}'::jsonb, NULL, NULL, NULL);
    BEGIN
        PERFORM 1 FROM vc.go_admin_mark_model_tool_calls_verified(
            29701, 'p297', 'm@chat', v_protocol, v_base, v_model, v_revision);
        RAISE EXCEPTION 'stale model was verified';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale model was verified%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%tool call verification identity changed%' THEN
            RAISE EXCEPTION 'model mismatch %', SQLERRM;
        END IF;
    END;
    SELECT capabilities->>'toolCalls' INTO v_calls
      FROM vc.provider_model WHERE provider_id = 'p297' AND profile_key = 'm@chat';
    IF v_calls IS DISTINCT FROM 'DECLARED' THEN
        RAISE EXCEPTION 'model mismatch changed capability %', v_calls;
    END IF;

    SELECT p.protocol, p.base_url, m.model_id, p.revision
      INTO v_protocol, v_base, v_model, v_revision
      FROM vc.provider_config p
      JOIN vc.provider_model m ON m.provider_id = p.provider_id
     WHERE p.provider_id = 'p297' AND m.profile_key = 'm@chat';
    BEGIN
        PERFORM 1 FROM vc.go_admin_mark_model_tool_calls_verified(
            29701, 'p297', 'm@chat', v_protocol, 'https://other.example/v1', v_model, v_revision);
        RAISE EXCEPTION 'stale base url was verified';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale base url was verified%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%tool call verification identity changed%' THEN
            RAISE EXCEPTION 'base mismatch %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM 1 FROM vc.go_admin_mark_model_tool_calls_verified(
            29701, 'p297', 'm@chat', v_protocol, v_base, v_model, v_revision + 1);
        RAISE EXCEPTION 'stale revision was verified';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale revision was verified%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%tool call verification identity changed%' THEN
            RAISE EXCEPTION 'revision mismatch %', SQLERRM;
        END IF;
    END;
    PERFORM 1 FROM vc.go_admin_mark_model_tool_calls_verified(
        29701, 'p297', 'm@chat', v_protocol, v_base, v_model, v_revision);
    SELECT capabilities->>'toolCalls' INTO v_calls
      FROM vc.provider_model WHERE provider_id = 'p297' AND profile_key = 'm@chat';
    IF v_calls IS DISTINCT FROM 'VERIFIED' THEN
        RAISE EXCEPTION 'matching identity did not verify %', v_calls;
    END IF;
END $$;

DELETE FROM vc.provider_model WHERE provider_id = 'p297';
DELETE FROM vc.provider_deployment WHERE provider_id = 'p297';
DELETE FROM vc.provider_config WHERE provider_id = 'p297';
