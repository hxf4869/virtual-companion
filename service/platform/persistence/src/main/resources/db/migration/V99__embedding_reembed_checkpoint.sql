-- S0-09: dual-space embedding migration, resumable checkpoint re-embed, and
-- explicit old-space retirement. Canonical memory remains vc.memory_item; this
-- job stores no plaintext outside the existing encrypted summary column.

SET search_path TO vc, pg_catalog;

-- One memory may carry old and target spaces during migration. Semantic recall
-- already requires an exact space id, so the two spaces can never mix.
ALTER TABLE vc.memory_embedding DROP CONSTRAINT memory_embedding_pkey;
ALTER TABLE vc.memory_embedding
    ADD PRIMARY KEY (owner_user_id, memory_item_id, embedding_space_id);

CREATE OR REPLACE FUNCTION vc.upsert_memory_embedding(
    p_owner_user_id       bigint,
    p_memory_item_id      bigint,
    p_model_id            text,
    p_model_version       text,
    p_dimension           int,
    p_space_id            text,
    p_vector_literal      text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_memory_item_id IS NULL OR p_memory_item_id <= 0 THEN
        RAISE EXCEPTION 'upsert_memory_embedding: ids are required';
    END IF;
    IF p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_version IS NULL OR btrim(p_model_version) = ''
       OR p_space_id IS NULL OR btrim(p_space_id) = ''
       OR p_vector_literal IS NULL OR btrim(p_vector_literal) = '' THEN
        RAISE EXCEPTION 'upsert_memory_embedding: model/version/space/vector are required';
    END IF;
    IF p_dimension <> 64 THEN
        RAISE EXCEPTION 'upsert_memory_embedding: only dimension 64 is registered';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'upsert_memory_embedding: owner_user_id must match server-trusted context';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_memory_item_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND m.superseded_at IS NULL) THEN
        RAISE EXCEPTION 'upsert_memory_embedding: memory item is absent or deleted';
    END IF;

    INSERT INTO vc.memory_embedding(
        owner_user_id, memory_item_id, embedding, embedding_model_id,
        embedding_model_version, dimension, embedding_space_id)
    VALUES (
        p_owner_user_id, p_memory_item_id, p_vector_literal::public.vector,
        btrim(p_model_id), btrim(p_model_version), p_dimension, btrim(p_space_id))
    ON CONFLICT (owner_user_id, memory_item_id, embedding_space_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            embedding_model_id = EXCLUDED.embedding_model_id,
            embedding_model_version = EXCLUDED.embedding_model_version,
            dimension = EXCLUDED.dimension,
            created_at = now();
    RETURN TRUE;
END;
$$;

CREATE TABLE vc.embedding_reembed_job (
    target_space_id     text PRIMARY KEY,
    source_space_id     text NOT NULL,
    model_id            text NOT NULL,
    model_version       text NOT NULL,
    dimension           integer NOT NULL,
    status              text NOT NULL,
    last_memory_item_id bigint NOT NULL DEFAULT 0,
    processed_count     bigint NOT NULL DEFAULT 0,
    skipped_count       bigint NOT NULL DEFAULT 0,
    failure_count       bigint NOT NULL DEFAULT 0,
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT embedding_reembed_distinct_space CHECK (target_space_id <> source_space_id),
    CONSTRAINT embedding_reembed_dimension CHECK (dimension = 64),
    CONSTRAINT embedding_reembed_status CHECK (
        status IN ('PAUSED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_FAILURES')),
    CONSTRAINT embedding_reembed_counts CHECK (
        last_memory_item_id >= 0 AND processed_count >= 0
        AND skipped_count >= 0 AND failure_count >= 0)
);

REVOKE ALL ON TABLE vc.embedding_reembed_job
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE vc.memory_embedding
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.ensure_embedding_reembed_job(
    p_target_space_id text,
    p_source_space_id text,
    p_model_id text,
    p_model_version text,
    p_dimension integer,
    p_start boolean
)
    RETURNS TABLE(out_status text, out_last_memory_item_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_job vc.embedding_reembed_job%ROWTYPE;
BEGIN
    IF p_target_space_id IS NULL OR btrim(p_target_space_id) = ''
       OR p_source_space_id IS NULL OR btrim(p_source_space_id) = ''
       OR p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_version IS NULL OR btrim(p_model_version) = '' THEN
        RAISE EXCEPTION 'ensure_embedding_reembed_job: lineage fields are required';
    END IF;
    IF btrim(p_target_space_id) = btrim(p_source_space_id) OR p_dimension <> 64 THEN
        RAISE EXCEPTION 'ensure_embedding_reembed_job: target/source/dimension are invalid';
    END IF;

    SELECT * INTO v_job FROM vc.embedding_reembed_job
     WHERE target_space_id = btrim(p_target_space_id) FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO vc.embedding_reembed_job(
            target_space_id, source_space_id, model_id, model_version,
            dimension, status)
        VALUES (btrim(p_target_space_id), btrim(p_source_space_id),
                btrim(p_model_id), btrim(p_model_version), p_dimension,
                CASE WHEN p_start THEN 'RUNNING' ELSE 'PAUSED' END)
        RETURNING * INTO v_job;
    ELSIF v_job.source_space_id IS DISTINCT FROM btrim(p_source_space_id)
       OR v_job.model_id IS DISTINCT FROM btrim(p_model_id)
       OR v_job.model_version IS DISTINCT FROM btrim(p_model_version)
       OR v_job.dimension IS DISTINCT FROM p_dimension THEN
        RAISE EXCEPTION 'ensure_embedding_reembed_job: target space lineage is immutable';
    END IF;
    RETURN QUERY SELECT v_job.status, v_job.last_memory_item_id;
END;
$$;

CREATE FUNCTION vc.set_embedding_reembed_status(p_target_space_id text, p_status text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_status NOT IN ('PAUSED', 'RUNNING') THEN
        RAISE EXCEPTION 'set_embedding_reembed_status: status must be PAUSED or RUNNING';
    END IF;
    UPDATE vc.embedding_reembed_job
       SET status = p_status,
           last_memory_item_id = CASE
               WHEN p_status = 'RUNNING'
                AND status = 'COMPLETED_WITH_FAILURES' THEN 0
               ELSE last_memory_item_id END,
           failure_count = CASE
               WHEN p_status = 'RUNNING'
                AND status = 'COMPLETED_WITH_FAILURES' THEN 0
               ELSE failure_count END,
           updated_at = now()
     WHERE target_space_id = btrim(p_target_space_id);
    RETURN FOUND;
END;
$$;

CREATE FUNCTION vc.claim_embedding_reembed_batch(p_target_space_id text, p_limit integer)
    RETURNS TABLE(out_owner_user_id bigint, out_memory_item_id bigint, out_stored_summary text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_job vc.embedding_reembed_job%ROWTYPE;
    v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 16), 1), 100);
BEGIN
    SELECT * INTO v_job FROM vc.embedding_reembed_job
     WHERE target_space_id = btrim(p_target_space_id) FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'claim_embedding_reembed_batch: job not found';
    END IF;
    IF v_job.status <> 'RUNNING' THEN
        RETURN;
    END IF;

    RETURN QUERY
    SELECT m.owner_user_id, m.id, m.summary
      FROM vc.memory_item m
     WHERE m.id > v_job.last_memory_item_id
       AND m.status = 'ACCEPTED'
       AND m.deleted_at IS NULL
       AND m.superseded_at IS NULL
       AND EXISTS (
           SELECT 1 FROM vc.memory_embedding old_e
            WHERE old_e.owner_user_id = m.owner_user_id
              AND old_e.memory_item_id = m.id
              AND old_e.embedding_space_id = v_job.source_space_id)
       AND NOT EXISTS (
           SELECT 1 FROM vc.memory_embedding e
            WHERE e.owner_user_id = m.owner_user_id
              AND e.memory_item_id = m.id
              AND e.embedding_space_id = v_job.target_space_id)
     ORDER BY m.id
     LIMIT v_limit;

    IF NOT FOUND THEN
        UPDATE vc.embedding_reembed_job
           SET status = CASE WHEN failure_count = 0
                             THEN 'COMPLETED' ELSE 'COMPLETED_WITH_FAILURES' END,
               updated_at = now()
         WHERE target_space_id = v_job.target_space_id;
    END IF;
END;
$$;

CREATE FUNCTION vc.complete_embedding_reembed_item(
    p_target_space_id text,
    p_owner_user_id bigint,
    p_memory_item_id bigint,
    p_outcome text,
    p_vector_literal text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_job vc.embedding_reembed_job%ROWTYPE;
    v_written boolean := false;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR p_memory_item_id IS NULL OR p_memory_item_id <= 0 THEN
        RAISE EXCEPTION 'complete_embedding_reembed_item: ids are required';
    END IF;
    IF p_outcome NOT IN ('SUCCEEDED', 'FAILED') THEN
        RAISE EXCEPTION 'complete_embedding_reembed_item: unsupported outcome';
    END IF;
    SELECT * INTO v_job FROM vc.embedding_reembed_job
     WHERE target_space_id = btrim(p_target_space_id) FOR UPDATE;
    IF NOT FOUND OR v_job.status <> 'RUNNING' THEN
        RETURN FALSE;
    END IF;
    IF p_memory_item_id <= v_job.last_memory_item_id THEN
        RETURN FALSE;
    END IF;

    IF p_outcome = 'SUCCEEDED' THEN
        IF p_vector_literal IS NULL OR btrim(p_vector_literal) = '' THEN
            RAISE EXCEPTION 'complete_embedding_reembed_item: vector is required';
        END IF;
        INSERT INTO vc.memory_embedding(
            owner_user_id, memory_item_id, embedding, embedding_model_id,
            embedding_model_version, dimension, embedding_space_id)
        SELECT m.owner_user_id, m.id, p_vector_literal::public.vector,
               v_job.model_id, v_job.model_version, v_job.dimension,
               v_job.target_space_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_memory_item_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND m.superseded_at IS NULL
        ON CONFLICT (owner_user_id, memory_item_id, embedding_space_id) DO UPDATE
            SET embedding = EXCLUDED.embedding,
                embedding_model_id = EXCLUDED.embedding_model_id,
                embedding_model_version = EXCLUDED.embedding_model_version,
                dimension = EXCLUDED.dimension,
                created_at = now();
        v_written := FOUND;
    END IF;

    UPDATE vc.embedding_reembed_job
       SET last_memory_item_id = p_memory_item_id,
           processed_count = processed_count
               + CASE WHEN p_outcome = 'SUCCEEDED' AND v_written THEN 1 ELSE 0 END,
           skipped_count = skipped_count
               + CASE WHEN p_outcome = 'SUCCEEDED' AND NOT v_written THEN 1 ELSE 0 END,
           failure_count = failure_count
               + CASE WHEN p_outcome = 'FAILED' THEN 1 ELSE 0 END,
           updated_at = now()
     WHERE target_space_id = v_job.target_space_id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.retire_embedding_space(p_source_space_id text)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.embedding_reembed_job j
         WHERE j.source_space_id = btrim(p_source_space_id)
           AND j.status = 'COMPLETED') THEN
        RAISE EXCEPTION 'retire_embedding_space: no successful completed migration';
    END IF;
    DELETE FROM vc.memory_embedding
     WHERE embedding_space_id = btrim(p_source_space_id);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION vc.upsert_memory_embedding(bigint, bigint, text, text, int, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.upsert_memory_embedding(bigint, bigint, text, text, int, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.ensure_embedding_reembed_job(text, text, text, text, integer, boolean),
    vc.set_embedding_reembed_status(text, text),
    vc.claim_embedding_reembed_batch(text, integer),
    vc.complete_embedding_reembed_item(text, bigint, bigint, text, text),
    vc.retire_embedding_space(text)
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT EXECUTE ON FUNCTION vc.ensure_embedding_reembed_job(text, text, text, text, integer, boolean),
    vc.set_embedding_reembed_status(text, text),
    vc.claim_embedding_reembed_batch(text, integer),
    vc.complete_embedding_reembed_item(text, bigint, bigint, text, text),
    vc.retire_embedding_space(text)
    TO vc_job_coordinator;
