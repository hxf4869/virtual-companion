-- 71_begin_job_context_permission_denied: TASK-0191 V27 revoked EXECUTE on
-- vc.begin_job_context from PUBLIC and from every runtime role. No
-- ordinary-runtime-callable arbitrary-owner entry point remains; only the
-- migrator/function-owner principal retains it. Asserts the denial for all
-- four runtime roles via SQLSTATE 42501 (assertions run under each REAL
-- runtime role; superuser only resets between probes).

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

DO $$
DECLARE
    role text;
BEGIN
    FOREACH role IN ARRAY ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher']
    LOOP
        EXECUTE format('SET ROLE %I', role);
        BEGIN
            EXECUTE 'SELECT vc.begin_job_context(1, ''ANY-NONEMPTY'')';
            RAISE EXCEPTION 'begin_job_context must be denied for %', role;
        EXCEPTION WHEN insufficient_privilege THEN
            NULL;  -- expected
        END;
    END LOOP;
END $$;
RESET ROLE;

-- Catalog assertions (fail-closed cross-check of the privilege edges).
DO $$
DECLARE
    role text;
BEGIN
    FOREACH role IN ARRAY ARRAY['vc_api','vc_worker','vc_job_coordinator','vc_dispatcher']
    LOOP
        IF has_function_privilege(role, 'vc.begin_job_context(bigint, text)', 'EXECUTE') THEN
            RAISE EXCEPTION 'privilege catalog: % still holds begin_job_context EXECUTE', role;
        END IF;
        IF NOT has_function_privilege(role, 'vc.set_owner_context(bigint, text, text)', 'EXECUTE') THEN
            RAISE EXCEPTION 'privilege catalog: % must hold set_owner_context EXECUTE', role;
        END IF;
    END LOOP;
    IF has_function_privilege('public', 'vc.begin_job_context(bigint, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'privilege catalog: PUBLIC still holds begin_job_context EXECUTE';
    END IF;
    IF has_function_privilege('public', 'vc.set_owner_context(bigint, text, text)', 'EXECUTE') THEN
        RAISE EXCEPTION 'privilege catalog: PUBLIC holds set_owner_context EXECUTE';
    END IF;
END $$;
