-- R44 MEM-SUPERSEDE / MEM-EVENT (V68): explicit supersede chain (§7.3.3, §11.11)
-- and the minimal event-memory lifecycle (§11.12) with lazy EXPIRED.
--
-- Supersede mirrors the V11 delete tombstone pattern: SUPERSEDED is carried by
-- nullable (superseded_at, superseded_by_memory_id) columns on the ACCEPTED row
-- instead of a status value, exactly like DELETED is carried by deleted_at. The
-- supersede is always an explicit user choice at confirm time
-- (confirm_memory_candidate p_supersede_memory_id) — nothing detects "same
-- kind" automatically and a user's manual edit is never auto-overridden
-- (§11.11: 如果语义不明确，询问用户，而不是自行覆盖).
--
-- Event memories carry (event_at, event_status, event_expires_at); the three
-- §11.12 fields the Alpha needs (时间/状态/到期). Lazy expiry: list/get/recall
-- mark ACCEPTED event rows whose event_expires_at passed as EXPIRED on read
-- (same lazy pattern as V61 trial grants). Recall already filters
-- status='ACCEPTED', so SUPERSEDED (column) and EXPIRED (status) rows both drop
-- out of the generation context; the recall output exposes event_at/event_status
-- so the assembler can demand follow-up questions instead of fabricated
-- outcomes (§11.12 模型不得因为计划日期已过就编造结果).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- Columns + structural checks.
-- ---------------------------------------------------------------------------
ALTER TABLE vc.memory_item
    ADD COLUMN IF NOT EXISTS superseded_at           timestamptz,
    ADD COLUMN IF NOT EXISTS superseded_by_memory_id bigint,
    ADD COLUMN IF NOT EXISTS event_at                timestamptz,
    ADD COLUMN IF NOT EXISTS event_status            text,
    ADD COLUMN IF NOT EXISTS event_expires_at        timestamptz;

-- The supersede pointer stays inside the owner's rows (composite ownership).
ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_supersede_fk;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_supersede_fk
    FOREIGN KEY (owner_user_id, superseded_by_memory_id)
    REFERENCES vc.memory_item(owner_user_id, id);

-- Event shape: any event field requires event_at (the §11.12 anchor); status is
-- a memory-event-statuses catalog code; expiry is strictly after the start.
ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_event_shape_check;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_event_shape_check CHECK (
        event_at IS NOT NULL
        OR (event_status IS NULL AND event_expires_at IS NULL)
    );

ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_event_status_check;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_event_status_check CHECK (
        event_status IS NULL
        OR event_status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'UNKNOWN')
    );

ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_event_expiry_after_start_check;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_event_expiry_after_start_check CHECK (
        event_at IS NULL OR event_expires_at IS NULL OR event_expires_at > event_at
    );

-- ---------------------------------------------------------------------------
-- create_memory_candidate: optional event fields (§11.12). Model-extracted
-- candidates keep calling the 6-arg form (no events — the deterministic
-- extractor never emits them); manual entry may pass the event triple.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.create_memory_candidate(bigint, bigint, text, text, bigint, text[]);
CREATE FUNCTION vc.create_memory_candidate(
    p_owner_user_id    bigint,
    p_relationship_id  bigint,
    p_scope            text,
    p_summary          text,
    p_conversation_id  bigint DEFAULT NULL,
    p_evidence         text[] DEFAULT ARRAY[]::text[],
    p_event_at         timestamptz DEFAULT NULL,
    p_event_status     text DEFAULT NULL,
    p_event_expires_at timestamptz DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_evidence text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: owner_user_id and relationship_id are required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'create_memory_candidate: summary is required';
    END IF;
    -- Alpha scope gate. ACCOUNT_PRIVATE/ACCOUNT_SHARED are not enabled in Alpha.
    IF p_scope NOT IN ('SESSION', 'RELATIONSHIP') THEN
        RAISE EXCEPTION 'create_memory_candidate: scope % is not enabled in Alpha', p_scope;
    END IF;
    -- SESSION requires a conversation binding (structural + redundant function check).
    IF p_scope = 'SESSION' AND p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: SESSION scope requires a conversation_id';
    END IF;
    -- Event shape (§11.12): any event field requires the anchor event_at; the
    -- status is a catalog code; expiry is strictly after the start.
    IF (p_event_status IS NOT NULL OR p_event_expires_at IS NOT NULL)
       AND p_event_at IS NULL THEN
        RAISE EXCEPTION 'create_memory_candidate: event_status/event_expires_at require event_at';
    END IF;
    IF p_event_status IS NOT NULL AND p_event_status NOT IN
       ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'create_memory_candidate: unknown event_status %', p_event_status;
    END IF;
    IF p_event_at IS NOT NULL AND p_event_expires_at IS NOT NULL
       AND p_event_expires_at <= p_event_at THEN
        RAISE EXCEPTION 'create_memory_candidate: event_expires_at must be after event_at';
    END IF;

    -- The relationship (and, for SESSION, the conversation) must belong to this
    -- owner; FORCE RLS makes a foreign id resolve to no row.
    PERFORM 1 FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_memory_candidate: relationship % not found for owner %',
            p_relationship_id, p_owner_user_id;
    END IF;
    IF p_scope = 'SESSION' THEN
        PERFORM 1 FROM vc.conversation c
          WHERE c.owner_user_id = p_owner_user_id AND c.id = p_conversation_id
            AND c.relationship_id = p_relationship_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'create_memory_candidate: conversation % not found for owner/relationship',
                p_conversation_id;
        END IF;
    END IF;

    v_id := nextval('vc.memory_id_seq');
    INSERT INTO vc.memory_item(
        owner_user_id, id, relationship_id, scope, summary, status, conversation_id,
        event_at, event_status, event_expires_at)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'PENDING_CONFIRMATION', p_conversation_id,
        -- A non-event candidate keeps every event column NULL (the shape CHECK
        -- forbids a status without the event_at anchor); an event candidate
        -- defaults to PLANNED (§11.12).
        p_event_at,
        CASE WHEN p_event_at IS NULL THEN NULL
             ELSE COALESCE(p_event_status, 'PLANNED') END,
        p_event_expires_at);

    -- Evidence chain: each cited source becomes a memory_evidence row.
    IF p_evidence IS NOT NULL THEN
        FOREACH v_evidence IN ARRAY p_evidence LOOP
            IF v_evidence IS NOT NULL AND btrim(v_evidence) <> '' THEN
                INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref)
                VALUES (p_owner_user_id, nextval('vc.memory_id_seq'), v_id, v_evidence);
            END IF;
        END LOOP;
    END IF;

    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- confirm_memory_candidate: optional explicit supersede (§11.11). The target
-- must be an active canonical memory of the SAME relationship (never another
-- owner's or another relationship's, never itself, never already superseded or
-- deleted). Old and new keep their rows and evidence — the chain is audit, not
-- destruction.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.confirm_memory_candidate(bigint, bigint);
CREATE FUNCTION vc.confirm_memory_candidate(
    p_owner_user_id       bigint,
    p_memory_id           bigint,
    p_supersede_memory_id bigint DEFAULT NULL
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status       text;
    v_deleted      timestamptz;
    v_relationship bigint;
    v_t_status     text;
    v_t_deleted    timestamptz;
    v_t_superseded timestamptz;
    v_t_relationship bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'confirm_memory_candidate: owner_user_id and memory_id are required';
    END IF;
    IF p_supersede_memory_id = p_memory_id THEN
        RAISE EXCEPTION 'confirm_memory_candidate: a memory cannot supersede itself';
    END IF;

    SELECT m.status, m.deleted_at, m.relationship_id
      INTO v_status, v_deleted, v_relationship
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id AND m.id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'confirm_memory_candidate: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    IF v_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'confirm_memory_candidate: memory % is deleted', p_memory_id;
    END IF;
    IF v_status <> 'PENDING_CONFIRMATION' THEN
        RAISE EXCEPTION 'confirm_memory_candidate: memory % is not pending confirmation (status %)',
            p_memory_id, v_status;
    END IF;

    IF p_supersede_memory_id IS NOT NULL THEN
        SELECT m.status, m.deleted_at, m.superseded_at, m.relationship_id
          INTO v_t_status, v_t_deleted, v_t_superseded, v_t_relationship
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id AND m.id = p_supersede_memory_id
         FOR UPDATE;
        IF NOT FOUND OR v_t_deleted IS NOT NULL THEN
            RAISE EXCEPTION 'confirm_memory_candidate: supersede target % not found for owner %',
                p_supersede_memory_id, p_owner_user_id;
        END IF;
        IF v_t_relationship IS DISTINCT FROM v_relationship THEN
            RAISE EXCEPTION 'confirm_memory_candidate: supersede target belongs to another relationship';
        END IF;
        IF v_t_status <> 'ACCEPTED' OR v_t_superseded IS NOT NULL THEN
            RAISE EXCEPTION
                'confirm_memory_candidate: supersede target % is not an active canonical memory (status %)',
                p_supersede_memory_id, v_t_status;
        END IF;
    END IF;

    UPDATE vc.memory_item
       SET status = 'ACCEPTED'
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;

    IF p_supersede_memory_id IS NOT NULL THEN
        UPDATE vc.memory_item
           SET superseded_at = now(),
               superseded_by_memory_id = p_memory_id
         WHERE owner_user_id = p_owner_user_id AND id = p_supersede_memory_id;
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- update_memory: optional event edits. NULL event params leave the stored
-- values unchanged (summary stays required — the API always resends it).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.update_memory(bigint, bigint, text);
CREATE FUNCTION vc.update_memory(
    p_owner_user_id     bigint,
    p_memory_id         bigint,
    p_summary           text,
    p_event_at          timestamptz DEFAULT NULL,
    p_event_status      text DEFAULT NULL,
    p_event_expires_at  timestamptz DEFAULT NULL
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status  text;
    v_deleted timestamptz;
    v_event_at timestamptz;
    v_event_status text;
    v_event_expires_at timestamptz;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'update_memory: owner_user_id and memory_id are required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'update_memory: summary is required and must not be blank';
    END IF;
    IF p_event_status IS NOT NULL AND p_event_status NOT IN
       ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'update_memory: unknown event_status %', p_event_status;
    END IF;

    SELECT m.status, m.deleted_at, m.event_at, m.event_status, m.event_expires_at
      INTO v_status, v_deleted, v_event_at, v_event_status, v_event_expires_at
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id AND m.id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'update_memory: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    IF v_deleted IS NOT NULL THEN
        RAISE EXCEPTION 'update_memory: memory % is deleted', p_memory_id;
    END IF;
    IF v_status NOT IN ('PENDING_CONFIRMATION', 'ACCEPTED') THEN
        RAISE EXCEPTION 'update_memory: memory % is in non-editable status %',
            p_memory_id, v_status;
    END IF;

    -- Effective values (NULL param = keep stored), then re-check the §11.12 shape.
    v_event_at := COALESCE(p_event_at, v_event_at);
    v_event_status := COALESCE(p_event_status, v_event_status);
    v_event_expires_at := COALESCE(p_event_expires_at, v_event_expires_at);
    IF (v_event_status IS NOT NULL OR v_event_expires_at IS NOT NULL)
       AND v_event_at IS NULL THEN
        RAISE EXCEPTION 'update_memory: event_status/event_expires_at require event_at';
    END IF;
    IF v_event_at IS NOT NULL AND v_event_expires_at IS NOT NULL
       AND v_event_expires_at <= v_event_at THEN
        RAISE EXCEPTION 'update_memory: event_expires_at must be after event_at';
    END IF;

    UPDATE vc.memory_item
       SET summary = p_summary,
           event_at = v_event_at,
           event_status = v_event_status,
           event_expires_at = v_event_expires_at
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_memory / get_memory: supersede + event columns out; list/get lazily
-- EXPIRE due event rows first (V61 trial-grant pattern — the read itself is
-- the sweeper, no cron needed for the Alpha).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.list_memory(bigint, bigint, boolean);
CREATE FUNCTION vc.list_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_include_deleted boolean DEFAULT false
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_status text, out_conversation_id bigint,
                  out_deleted_at timestamptz, out_created_at timestamptz,
                  out_auto_saved boolean,
                  out_superseded_at timestamptz,
                  out_superseded_by_memory_id bigint,
                  out_event_at timestamptz, out_event_status text,
                  out_event_expires_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'list_memory: owner_user_id and relationship_id are required';
    END IF;

    UPDATE vc.memory_item
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACCEPTED'
       AND deleted_at IS NULL
       AND superseded_at IS NULL
       AND event_expires_at IS NOT NULL
       AND event_expires_at < now();

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.status, m.conversation_id,
               m.deleted_at, m.created_at, m.auto_saved,
               m.superseded_at, m.superseded_by_memory_id,
               m.event_at, m.event_status, m.event_expires_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND (p_include_deleted OR m.deleted_at IS NULL)
         ORDER BY m.created_at, m.id;
END;
$$;

DROP FUNCTION IF EXISTS vc.get_memory(bigint, bigint);
CREATE FUNCTION vc.get_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_scope text,
                  out_summary text, out_status text, out_conversation_id bigint,
                  out_created_at timestamptz, out_auto_saved boolean,
                  out_superseded_at timestamptz,
                  out_superseded_by_memory_id bigint,
                  out_event_at timestamptz, out_event_status text,
                  out_event_expires_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'get_memory: owner_user_id and memory_id are required';
    END IF;

    UPDATE vc.memory_item
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACCEPTED'
       AND deleted_at IS NULL
       AND superseded_at IS NULL
       AND event_expires_at IS NOT NULL
       AND event_expires_at < now();

    RETURN QUERY
        SELECT m.id, m.relationship_id, m.scope, m.summary, m.status,
               m.conversation_id, m.created_at, m.auto_saved,
               m.superseded_at, m.superseded_by_memory_id,
               m.event_at, m.event_status, m.event_expires_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_memory_id
           AND m.deleted_at IS NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- recall_memory: exclude superseded rows; expose event fields for the §11.12
-- follow-up instruction; lazily EXPIRE due events so stale plans never feed
-- the generation context as fresh facts.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.recall_memory(bigint, bigint, bigint, int);
CREATE FUNCTION vc.recall_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_conversation_id bigint DEFAULT NULL,
    p_max_entries     int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_conversation_id bigint, out_created_at timestamptz,
                  out_event_at timestamptz, out_event_status text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'recall_memory: owner_user_id and relationship_id are required';
    END IF;

    UPDATE vc.memory_item
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACCEPTED'
       AND deleted_at IS NULL
       AND superseded_at IS NULL
       AND event_expires_at IS NOT NULL
       AND event_expires_at < now();

    v_limit := LEAST(GREATEST(p_max_entries, 1), 100);

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.conversation_id, m.created_at,
               m.event_at, m.event_status
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND m.superseded_at IS NULL
           AND (
                    m.scope = 'RELATIONSHIP'
                 OR (    m.scope = 'SESSION'
                     AND p_conversation_id IS NOT NULL
                     AND m.conversation_id = p_conversation_id)
           )
         ORDER BY m.scope, m.created_at, m.id
         LIMIT v_limit;
END;
$$;

-- semantic_recall: same-exclusion fix — a superseded row must not resurface
-- through its (stale) embedding (§11.16 防复活 applies to supersede too).
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
       AND m.superseded_at IS NULL
     ORDER BY e.embedding OPERATOR(public.<=>) v_query
     LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: every dropped-and-recreated function lost its grants (new OIDs).
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION
    vc.create_memory_candidate(bigint, bigint, text, text, bigint, text[],
                               timestamptz, text, timestamptz),
    vc.confirm_memory_candidate(bigint, bigint, bigint),
    vc.update_memory(bigint, bigint, text, timestamptz, text, timestamptz),
    vc.list_memory(bigint, bigint, boolean),
    vc.get_memory(bigint, bigint),
    vc.recall_memory(bigint, bigint, bigint, int),
    vc.semantic_recall(bigint, bigint, text, text, int)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.create_memory_candidate(bigint, bigint, text, text, bigint, text[],
                               timestamptz, text, timestamptz),
    vc.confirm_memory_candidate(bigint, bigint, bigint),
    vc.update_memory(bigint, bigint, text, timestamptz, text, timestamptz),
    vc.list_memory(bigint, bigint, boolean),
    vc.get_memory(bigint, bigint),
    vc.recall_memory(bigint, bigint, bigint, int),
    vc.semantic_recall(bigint, bigint, text, text, int)
    TO vc_api;
