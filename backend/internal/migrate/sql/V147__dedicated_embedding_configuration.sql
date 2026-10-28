-- W08-3: one Go-owned embedding snapshot, separate from chat profiles. No
-- production memory queue is switched. Runtime roles access bounded functions.
SET search_path TO vc, pg_catalog;

CREATE TABLE vc.embedding_config (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    model text NOT NULL CHECK (char_length(model) BETWEEN 1 AND 256),
    artifact_version text NOT NULL CHECK (char_length(artifact_version) BETWEEN 1 AND 256),
    dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 4096),
    query_preprocessing text NOT NULL CHECK (query_preprocessing IN ('qwen3-retrieval-v1', 'identity-v1')),
    document_preprocessing text NOT NULL CHECK (document_preprocessing = 'identity-v1'),
    normalization text NOT NULL CHECK (normalization IN ('l2', 'none')),
    state text NOT NULL CHECK (state IN ('ENABLED', 'DISABLED')),
    revision bigint NOT NULL CHECK (revision > 0),
    space_id uuid NOT NULL,
    updated_by bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vc.embedding_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.embedding_config FORCE ROW LEVEL SECURITY;
REVOKE ALL ON vc.embedding_config FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.go_admin_get_embedding_config(p_actor bigint)
RETURNS SETOF vc.embedding_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_actor);
    RETURN QUERY SELECT * FROM vc.embedding_config;
END;
$$;

CREATE FUNCTION vc.go_admin_save_embedding_config(
    p_actor bigint, p_model text, p_artifact text, p_dimensions integer,
    p_query text, p_document text, p_normalization text, p_state text, p_expected bigint)
RETURNS SETOF vc.embedding_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE
    old vc.embedding_config;
    next_space uuid;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_actor);
    -- Serialize initial insertion too, without a general-purpose locking layer.
    LOCK TABLE vc.embedding_config IN EXCLUSIVE MODE;
    SELECT * INTO old FROM vc.embedding_config;
    IF p_expected IS NULL OR p_expected <> COALESCE(old.revision, 0) THEN
        RAISE EXCEPTION 'go_admin_provider: revision conflict (current %)', COALESCE(old.revision, 0);
    END IF;
    next_space := CASE WHEN old.space_id IS NOT NULL AND
        ROW(old.model, old.artifact_version, old.dimensions, old.query_preprocessing,
            old.document_preprocessing, old.normalization) IS NOT DISTINCT FROM
        ROW(p_model, p_artifact, p_dimensions, p_query, p_document, p_normalization)
        THEN old.space_id ELSE gen_random_uuid() END;
    INSERT INTO vc.embedding_config(singleton, model, artifact_version, dimensions,
        query_preprocessing, document_preprocessing, normalization, state, revision, space_id, updated_by)
    VALUES(true, p_model, p_artifact, p_dimensions, p_query, p_document,
        p_normalization, p_state, COALESCE(old.revision, 0) + 1, next_space, p_actor)
    ON CONFLICT (singleton) DO UPDATE SET model = excluded.model,
        artifact_version = excluded.artifact_version, dimensions = excluded.dimensions,
        query_preprocessing = excluded.query_preprocessing, document_preprocessing = excluded.document_preprocessing,
        normalization = excluded.normalization, state = excluded.state, revision = excluded.revision,
        space_id = excluded.space_id, updated_by = excluded.updated_by, updated_at = now();
    RETURN QUERY SELECT * FROM vc.embedding_config;
END;
$$;

CREATE FUNCTION vc.go_service_resolve_embedding_config(p_owner bigint)
RETURNS SETOF vc.embedding_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    IF p_owner IS NULL OR p_owner <= 0 OR NOT EXISTS (
        SELECT 1 FROM vc.identity_account WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    RETURN QUERY SELECT * FROM vc.embedding_config WHERE state = 'ENABLED';
END;
$$;
REVOKE ALL ON FUNCTION vc.go_admin_get_embedding_config(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_save_embedding_config(bigint,text,text,integer,text,text,text,text,bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_service_resolve_embedding_config(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_admin_get_embedding_config(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_save_embedding_config(bigint,text,text,integer,text,text,text,text,bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_service_resolve_embedding_config(bigint) TO vc_api;
