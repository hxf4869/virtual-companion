-- EMBED-RECALL / DEGRADED-AI V62: deterministic embeddings + semantic recall,
-- and the entitled-vs-actual service class on the snapshot.
--
-- EMBED-RECALL (§11.13/§11.15/§11.17): vc.memory_embedding stores one vector
-- per confirmed memory with the full model/space lineage (embedding_model_id,
-- version, dimension, embedding_space_id) — 绝不能只保存向量而不保存结构化
-- 原文 remains true (memory_item stays the canonical source). Alpha embeds
-- with a DETERMINISTIC hash embedder (64 dims, space alpha-hash-64) so the
-- whole recall path runs locally; a real embedding provider later replaces
-- the port, never the tables. upsert is idempotent per memory (§11.17 double
-- write/switch groundwork); semantic_recall is cosine-distance over the same
-- space only, restricted to ACCEPTED non-deleted rows of the owner.
--
-- DEGRADED-AI (§12.10 / FR-RES-005 / FR-ENT-006): entitlement_snapshot gains
-- actual_service_class. mint accepts the runtime-computed actual class
-- (deployment-level degradation, e.g. PREMIUM entitled but ECONOMY running);
-- NULL keeps it equal to the entitled class. The entitled-vs-actual pair is
-- the durable 应得 vs 实际 record.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- EMBED-RECALL: memory embeddings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vc.memory_embedding (
    owner_user_id        bigint      NOT NULL,
    memory_item_id       bigint      NOT NULL,
    embedding            public.vector(64)  NOT NULL,
    embedding_model_id   text        NOT NULL,
    embedding_model_version text     NOT NULL,
    dimension            integer     NOT NULL,
    embedding_space_id   text        NOT NULL,
    created_at           timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, memory_item_id),
    FOREIGN KEY (owner_user_id, memory_item_id)
        REFERENCES vc.memory_item(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT memory_embedding_dim_check CHECK (dimension = 64)
);

ALTER TABLE vc.memory_embedding ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memory_embedding FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.memory_embedding;
CREATE POLICY owner_isolation ON vc.memory_embedding FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.memory_embedding
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- upsert_memory_embedding: idempotent write of one memory's vector. The
-- vector travels as the pgvector text literal (validated by the cast).
-- ---------------------------------------------------------------------------
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
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'upsert_memory_embedding: owner_user_id is required';
    END IF;
    IF p_memory_item_id IS NULL OR p_memory_item_id <= 0 THEN
        RAISE EXCEPTION 'upsert_memory_embedding: memory_item_id is required';
    END IF;
    IF p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_version IS NULL OR btrim(p_model_version) = ''
       OR p_space_id IS NULL OR btrim(p_space_id) = '' THEN
        RAISE EXCEPTION 'upsert_memory_embedding: model/version/space are required';
    END IF;
    IF p_dimension <> 64 THEN
        RAISE EXCEPTION 'upsert_memory_embedding: only dimension 64 is registered';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'upsert_memory_embedding: owner_user_id must match server-trusted context';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.memory_item m
                    WHERE m.owner_user_id = p_owner_user_id
                      AND m.id = p_memory_item_id
                      AND m.deleted_at IS NULL) THEN
        RAISE EXCEPTION 'upsert_memory_embedding: memory item is absent or deleted';
    END IF;

    INSERT INTO vc.memory_embedding(
        owner_user_id, memory_item_id, embedding, embedding_model_id,
        embedding_model_version, dimension, embedding_space_id)
    VALUES (
        p_owner_user_id, p_memory_item_id, p_vector_literal::public.vector,
        btrim(p_model_id), btrim(p_model_version), p_dimension, btrim(p_space_id))
    ON CONFLICT (owner_user_id, memory_item_id) DO UPDATE
        SET embedding = EXCLUDED.embedding,
            embedding_model_id = EXCLUDED.embedding_model_id,
            embedding_model_version = EXCLUDED.embedding_model_version,
            embedding_space_id = EXCLUDED.embedding_space_id,
            created_at = now();
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- semantic_recall: cosine-nearest confirmed memories of the owner in the
-- SAME embedding space (§11.13 语义向量召回; structured recall stays the
-- other half — merge/dedupe happens in the runtime caller).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.semantic_recall(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_space_id        text,
    p_query_literal   text,
    p_limit           int DEFAULT 20
)
    RETURNS TABLE(out_memory_id bigint, out_summary text, out_distance double precision)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
    v_query public.vector;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'semantic_recall: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'semantic_recall: relationship_id is required';
    END IF;
    IF p_space_id IS NULL OR btrim(p_space_id) = '' THEN
        RAISE EXCEPTION 'semantic_recall: space_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'semantic_recall: owner_user_id must match server-trusted context';
    END IF;

    v_query := p_query_literal::public.vector;

    RETURN QUERY
    SELECT m.id, m.summary, (e.embedding OPERATOR(public.<=>) v_query)::double precision
      FROM vc.memory_embedding e
      JOIN vc.memory_item m
        ON m.owner_user_id = e.owner_user_id
       AND m.id = e.memory_item_id
     WHERE e.owner_user_id = p_owner_user_id
       AND e.embedding_space_id = btrim(p_space_id)
       AND m.relationship_id = p_relationship_id
       AND m.status = 'ACCEPTED'
       AND m.deleted_at IS NULL
     ORDER BY e.embedding OPERATOR(public.<=>) v_query
     LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- DEGRADED-AI: snapshot actual class (NULL keeps entitled==actual).
-- ---------------------------------------------------------------------------
ALTER TABLE vc.entitlement_snapshot
    ADD COLUMN IF NOT EXISTS actual_service_class text;

DROP FUNCTION IF EXISTS vc.mint_entitlement_snapshot(bigint, bigint, text);
DROP FUNCTION IF EXISTS vc.mint_entitlement_snapshot(bigint, bigint);

CREATE OR REPLACE FUNCTION vc.mint_entitlement_snapshot(
    p_owner_user_id bigint,
    p_generation_id bigint,
    p_degraded      boolean DEFAULT false
)
    RETURNS TABLE(out_id bigint, out_service_class text,
                  out_entitled_service_class text, out_actual_service_class text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_class     text := 'ECONOMY';
    v_entitled  text := 'ECONOMY';
    v_actual    text;
    v_source    text := 'ADMIN_ASSIGNMENT';
    v_trial_id  bigint;
    v_id        bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: generation id is required';
    END IF;
    IF p_degraded IS NULL THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: degraded flag is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: owner_user_id must match server-trusted context';
    END IF;

    -- Idempotent: a re-run resolves the existing snapshot unchanged.
    SELECT e.id, e.service_class, COALESCE(e.entitled_service_class, e.service_class),
           COALESCE(e.actual_service_class, e.service_class)
      INTO v_id, v_class, v_entitled, v_actual
      FROM vc.entitlement_snapshot e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.generation_id = p_generation_id;
    IF FOUND THEN
        RETURN QUERY SELECT v_id, v_class, v_entitled, v_actual;
        RETURN;
    END IF;

    UPDATE vc.trial_grant
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACTIVE' AND expires_at <= now();

    SELECT t.id INTO v_trial_id
      FROM vc.trial_grant t
     WHERE t.owner_user_id = p_owner_user_id
       AND t.status = 'ACTIVE' AND t.remaining_turns > 0
     ORDER BY t.id DESC
     LIMIT 1
       FOR UPDATE;

    IF v_trial_id IS NOT NULL THEN
        v_entitled := 'PREMIUM';
        v_class := 'PREMIUM';
        v_source := 'TRIAL_GRANT';
        UPDATE vc.trial_grant
           SET remaining_turns = remaining_turns - 1,
               status = CASE WHEN remaining_turns - 1 <= 0 THEN 'CONSUMED' ELSE status END
         WHERE owner_user_id = p_owner_user_id AND id = v_trial_id;
    ELSE
        SELECT COALESCE(s.service_class, 'ECONOMY') INTO v_entitled
          FROM (SELECT p_owner_user_id AS owner_user_id) o
          LEFT JOIN vc.service_class_assignment s
            ON s.owner_user_id = o.owner_user_id;
        v_class := v_entitled;
    END IF;

    -- DEGRADED-AI: the deployment may run one class below the entitlement;
    -- the snapshot's service_class is the ACTUAL class the router consumed.
    v_actual := CASE WHEN p_degraded AND v_entitled = 'PREMIUM'
                     THEN 'ECONOMY' ELSE v_entitled END;

    v_id := nextval('vc.entitlement_snapshot_id_seq');
    INSERT INTO vc.entitlement_snapshot
        (owner_user_id, id, generation_id, service_class, source,
         entitled_service_class, actual_service_class)
    VALUES
        (p_owner_user_id, v_id, p_generation_id, v_actual, v_source,
         v_entitled, v_actual);
    RETURN QUERY SELECT v_id, v_actual, v_entitled, v_actual;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.upsert_memory_embedding(bigint, bigint, text, text, int, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.semantic_recall(bigint, bigint, text, text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.mint_entitlement_snapshot(bigint, bigint, boolean) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.upsert_memory_embedding(bigint, bigint, text, text, int, text, text),
                vc.semantic_recall(bigint, bigint, text, text, int),
                vc.mint_entitlement_snapshot(bigint, bigint, boolean)
    TO vc_api;
