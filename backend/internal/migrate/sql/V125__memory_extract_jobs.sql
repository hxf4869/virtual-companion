-- WP-C 自动记忆真实闭环: generation 成功后异步提取"用户明确表达的普通偏好与
-- 明确事实"并直接落 ACCEPTED + auto_saved=true 记忆。
--
-- Four pieces (additive on V66/V115/V117/V29, no history edits):
--   * go_claim_jobs gains the MEMORY_EXTRACT kind (default lease; the worker
--     dispatch table owns the handler). Same signature/grants, body-only change.
--   * enqueue_memory_extract — the deterministic trigger: called once by the
--     generation worker after a COMPLETED finalize. It re-checks every trigger
--     precondition inside the guarded statement (owner pref ON, conversation
--     not incognito, source user message not no_memory) and inserts at most
--     one PENDING work_item per generation (partial unique index). A failed
--     enqueue must never affect the chat reply, so it returns NULL instead of
--     raising on suppressed sources.
--   * go_read_memory_extract_input — one guarded read of the finished turn:
--     relationship/conversation binding, both message ids, both no_memory
--     markers and both bodies (assistant content included). Evidence is stored
--     as "message:<id>" so the V57 delete tombstone flips both sources, which
--     is what blocks a retried job from resurrecting a deleted memory.
--   * create_auto_saved_memory gains p_idempotency_key (V115 pattern):
--     key auto<generation>-<index> makes repeated job runs return the existing
--     row instead of duplicating memories. Execution stays vc_api-only (V66,
--     pinned by test 121): the extraction job runs under the runtime login,
--     which inherits vc_api, so bare vc_worker keeps zero canonical-memory
--     write capability.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. Claim: MEMORY_EXTRACT joins the Go claim set on the default lease.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_claim_jobs(
    p_generation_lease_seconds integer,
    p_export_lease_seconds integer,
    p_default_lease_seconds integer,
    p_limit integer)
    RETURNS TABLE(
        out_owner_user_id bigint,
        out_job_id bigint,
        out_kind text,
        out_ref_id bigint,
        out_claim_token text,
        out_claim_fence text,
        out_lease_seconds integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit integer;
BEGIN
    IF p_generation_lease_seconds IS NULL OR p_generation_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: generation lease must be >= 5s';
    END IF;
    IF p_export_lease_seconds IS NULL OR p_export_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: export lease must be >= 5s';
    END IF;
    IF p_default_lease_seconds IS NULL OR p_default_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: default lease must be >= 5s';
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);

    RETURN QUERY
    WITH picked AS (
        SELECT wi.owner_user_id, wi.id
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind IN ('GENERATION', 'DATA_EXPORT', 'MEMORY_EXTRACT')
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    )
    UPDATE vc.work_item wi
       SET status = 'CLAIMED',
           claim_token = gen_random_uuid()::text,
           claim_fence = gen_random_uuid()::text,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs =>
               CASE wi.kind
                   WHEN 'GENERATION' THEN p_generation_lease_seconds
                   WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                   ELSE p_default_lease_seconds
               END)
      FROM picked p
     WHERE wi.owner_user_id = p.owner_user_id AND wi.id = p.id
    RETURNING wi.owner_user_id, wi.id, wi.kind, wi.ref_id, wi.claim_token, wi.claim_fence,
              CASE wi.kind
                  WHEN 'GENERATION' THEN p_generation_lease_seconds
                  WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                  ELSE p_default_lease_seconds
              END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Trigger: at most one MEMORY_EXTRACT job per completed generation.
--    Every suppression guard is deterministic SQL; nothing raises for a
--    suppressed turn (the caller logs and moves on either way).
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS work_item_memory_extract_uidx
    ON vc.work_item (owner_user_id, ref_id)
    WHERE kind = 'MEMORY_EXTRACT';

CREATE OR REPLACE FUNCTION vc.enqueue_memory_extract(
    p_owner_user_id  bigint,
    p_generation_id  bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_job bigint;
    v_conv bigint;
    v_src bigint;
    v_status text;
    v_assistant bigint;
    v_incognito boolean;
    v_no_memory boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'enqueue_memory_extract: generation_id is required';
    END IF;

    -- Idempotent: one extraction job per generation, even across crash/retry
    -- of the enqueue call itself.
    SELECT wi.id INTO v_job
      FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.kind = 'MEMORY_EXTRACT'
       AND wi.ref_id = p_generation_id;
    IF FOUND THEN
        RETURN v_job;
    END IF;

    SELECT g.conversation_id, g.source_user_message_id, g.status, g.assistant_message_id,
           c.incognito, COALESCE(m.no_memory, false)
      INTO v_conv, v_src, v_status, v_assistant,
           v_incognito, v_no_memory
      FROM vc.generation g
      JOIN vc.conversation c
        ON c.owner_user_id = g.owner_user_id AND c.id = g.conversation_id
      LEFT JOIN vc.message m
        ON m.owner_user_id = g.owner_user_id AND m.id = g.source_user_message_id
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'enqueue_memory_extract: generation not found';
    END IF;
    -- Suppressed turns are a normal outcome, not an error.
    IF v_status IS DISTINCT FROM 'COMPLETED'
       OR v_assistant IS NULL
       OR v_incognito
       OR v_no_memory THEN
        RETURN NULL;
    END IF;
    IF NOT vc.get_memory_auto_save_pref(p_owner_user_id) THEN
        RETURN NULL;
    END IF;

    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (p_owner_user_id, nextval('vc.work_item_id_seq'), 'MEMORY_EXTRACT', p_generation_id, 'PENDING')
    ON CONFLICT (owner_user_id, ref_id) WHERE kind = 'MEMORY_EXTRACT' DO NOTHING
    RETURNING id INTO v_job;
    RETURN v_job;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Bounded read of the finished turn for the extraction handler.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.go_read_memory_extract_input(
    p_owner_user_id bigint,
    p_generation_id bigint)
    RETURNS TABLE(
        out_relationship_id bigint,
        out_conversation_id bigint,
        out_status text,
        out_source_message_id bigint,
        out_assistant_message_id bigint,
        out_incognito boolean,
        out_user_content text,
        out_user_no_memory boolean,
        out_assistant_content text,
        out_assistant_no_memory boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    RETURN QUERY
        SELECT c.relationship_id, g.conversation_id, g.status,
               g.source_user_message_id, g.assistant_message_id,
               c.incognito,
               um.content, COALESCE(um.no_memory, false),
               am.content, COALESCE(am.no_memory, false)
          FROM vc.generation g
          JOIN vc.conversation c
            ON c.owner_user_id = g.owner_user_id AND c.id = g.conversation_id
          LEFT JOIN vc.message um
            ON um.owner_user_id = g.owner_user_id AND um.id = g.source_user_message_id
          LEFT JOIN vc.message am
            ON am.owner_user_id = g.owner_user_id AND am.id = g.assistant_message_id
         WHERE g.owner_user_id = p_owner_user_id
           AND g.id = p_generation_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. create_auto_saved_memory gains an idempotency key (V115 pattern). Same
--    ACCEPTED + auto_saved insert; a repeated call with the same key returns
--    the existing row so retried jobs cannot duplicate memories.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[]);
CREATE OR REPLACE FUNCTION vc.create_auto_saved_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_scope           text,
    p_summary         text,
    p_conversation_id bigint DEFAULT NULL,
    p_evidence        text[] DEFAULT ARRAY[]::text[],
    p_idempotency_key text DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_key text;
    v_evidence text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship_id is required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' OR length(p_summary) > 2000 THEN
        RAISE EXCEPTION 'create_auto_saved_memory: summary must be 1..2000 characters';
    END IF;
    IF p_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'create_auto_saved_memory: scope % is not enabled in Alpha', p_scope;
    END IF;
    IF p_scope = 'SESSION' AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'create_auto_saved_memory: SESSION scope requires a conversation_id';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_auto_saved_memory: owner_user_id must match server-trusted context';
    END IF;

    v_key := NULL;
    IF p_idempotency_key IS NOT NULL AND btrim(p_idempotency_key) <> '' THEN
        v_key := btrim(p_idempotency_key);
        IF v_key !~ '^[A-Za-z0-9._~-]{1,64}$' THEN
            RAISE EXCEPTION 'create_auto_saved_memory: idempotency_key is invalid';
        END IF;
        SELECT m.id INTO v_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.idempotency_key = v_key;
        IF FOUND THEN
            RETURN v_id;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM vc.relationship r
                    WHERE r.owner_user_id = p_owner_user_id
                      AND r.id = p_relationship_id) THEN
        RAISE EXCEPTION 'create_auto_saved_memory: relationship not found for owner';
    END IF;
    IF p_scope = 'SESSION' THEN
        IF NOT EXISTS (SELECT 1 FROM vc.conversation c
                        WHERE c.owner_user_id = p_owner_user_id
                          AND c.id = p_conversation_id
                          AND c.relationship_id = p_relationship_id) THEN
            RAISE EXCEPTION 'create_auto_saved_memory: conversation not found for owner/relationship';
        END IF;
    END IF;

    v_id := nextval('vc.memory_id_seq');
    INSERT INTO vc.memory_item(
        owner_user_id, id, relationship_id, scope, summary, status,
        conversation_id, auto_saved)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'ACCEPTED', p_conversation_id, true);

    IF p_evidence IS NOT NULL THEN
        FOREACH v_evidence IN ARRAY p_evidence LOOP
            IF v_evidence IS NOT NULL AND btrim(v_evidence) <> '' THEN
                INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref)
                VALUES (p_owner_user_id, nextval('vc.memory_id_seq'), v_id, v_evidence);
            END IF;
        END LOOP;
    END IF;

    IF v_key IS NOT NULL THEN
        UPDATE vc.memory_item
           SET idempotency_key = v_key
         WHERE owner_user_id = p_owner_user_id AND id = v_id;
    END IF;
    RETURN v_id;
EXCEPTION
    WHEN unique_violation THEN
        SELECT m.id INTO v_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.idempotency_key = v_key;
        IF v_id IS NULL THEN
            RAISE;
        END IF;
        RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants: the extraction job runs under the runtime login, which inherits
--    vc_api; create_auto_saved_memory and the pref functions deliberately keep
--    their V66 vc_api-only execution (test 121 pins that bare vc_worker stays
--    unable to write canonical memory). The new claim/read/trigger helpers
--    follow the V117 worker-claim grant pattern.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_claim_jobs(integer, integer, integer, integer)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.enqueue_memory_extract(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.enqueue_memory_extract(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_read_memory_extract_input(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_read_memory_extract_input(bigint, bigint)
    TO vc_api, vc_worker;

REVOKE EXECUTE ON FUNCTION
    vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[], text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.create_auto_saved_memory(bigint, bigint, text, text, bigint, text[], text)
    TO vc_api;
