-- Dedicated configuration uses the same administrator boundary as model
-- configuration. There is no chat profile or provider credential in this row.
\set ON_ERROR_STOP on
TRUNCATE vc.embedding_config;
INSERT INTO vc.vc_user(id, display_name) VALUES (14701, 'embedding admin'), (14702, 'embedding owner') ON CONFLICT DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (14701, 'embedding-admin', 'hash', 'ADMIN', 'ACTIVE', 'embedding admin'),
       (14702, 'embedding-owner', 'hash', 'USER', 'ACTIVE', 'embedding owner') ON CONFLICT DO NOTHING;
SET ROLE vc_api;
DO $$
DECLARE
    first_space uuid;
    next_space uuid;
BEGIN
    BEGIN
        PERFORM 1 FROM vc.embedding_config;
        RAISE EXCEPTION 'direct access must fail';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM * FROM vc.go_admin_save_embedding_config(14702, 'qwen3-embedding:0.6b', 'fixture-v1', 1024,
            'qwen3-retrieval-v1', 'identity-v1', 'l2', 'ENABLED', 0);
        RAISE EXCEPTION 'non-admin must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;
    SELECT space_id INTO first_space FROM vc.go_admin_save_embedding_config(14701, 'qwen3-embedding:0.6b', 'fixture-v1', 1024,
        'qwen3-retrieval-v1', 'identity-v1', 'l2', 'ENABLED', 0);
    IF first_space IS NULL THEN RAISE EXCEPTION 'space missing'; END IF;
    SELECT space_id INTO next_space FROM vc.go_service_resolve_embedding_config(14702);
    IF next_space IS DISTINCT FROM first_space THEN RAISE EXCEPTION 'resolved wrong space'; END IF;
    SELECT space_id INTO next_space FROM vc.go_admin_save_embedding_config(14701, 'qwen3-embedding:0.6b', 'fixture-v1', 1024,
        'qwen3-retrieval-v1', 'identity-v1', 'l2', 'ENABLED', 1);
    IF next_space IS DISTINCT FROM first_space THEN RAISE EXCEPTION 'unchanged space rotated'; END IF;
    SELECT space_id INTO next_space FROM vc.go_admin_save_embedding_config(14701, 'qwen3-embedding:0.6b', 'fixture-v2', 1024,
        'qwen3-retrieval-v1', 'identity-v1', 'l2', 'ENABLED', 2);
    IF next_space IS NOT DISTINCT FROM first_space THEN RAISE EXCEPTION 'artifact change did not rotate'; END IF;
    BEGIN
        PERFORM * FROM vc.go_admin_save_embedding_config(14701, 'qwen3-embedding:0.6b', 'fixture-v2', 1024,
            'qwen3-retrieval-v1', 'identity-v1', 'l2', 'ENABLED', 2);
        RAISE EXCEPTION 'stale revision must fail';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%revision conflict%' THEN RAISE; END IF;
    END;
END;
$$;
RESET ROLE;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vc' AND c.relname = 'embedding_config' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN
        RAISE EXCEPTION 'embedding configuration must force RLS';
    END IF;
    IF has_function_privilege('vc_worker', 'vc.go_admin_save_embedding_config(bigint,text,text,integer,text,text,text,text,bigint)', 'EXECUTE') THEN
        RAISE EXCEPTION 'worker may not change embedding configuration';
    END IF;
END $$;
