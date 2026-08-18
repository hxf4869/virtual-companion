-- MEM-IMPORT V55: explicit archive + import of ACCEPTED RELATIONSHIP memories
-- (FR-COMP-004). Reset/delete stay hard-clear unless retain_importable is true.
-- Same-template create never inherits unless the user POSTs import.

SET search_path TO vc, pg_catalog;

CREATE TABLE IF NOT EXISTS vc.memory_import_bundle (
    owner_user_id   bigint        NOT NULL,
    persona_ref     text          NOT NULL,
    item_count      integer       NOT NULL CHECK (item_count > 0),
    payload         jsonb         NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, persona_ref),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

ALTER TABLE vc.memory_import_bundle ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memory_import_bundle FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.memory_import_bundle;
CREATE POLICY owner_isolation ON vc.memory_import_bundle FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.memory_import_bundle
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE OR REPLACE FUNCTION vc.snapshot_importable_memories(
    p_owner_user_id   bigint,
    p_relationship_id bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_persona text;
    v_count   integer;
    v_payload jsonb;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'snapshot_importable_memories: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'snapshot_importable_memories: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'snapshot_importable_memories: owner_user_id must match server-trusted context';
    END IF;

    SELECT r.persona_ref INTO v_persona
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.id = p_relationship_id;
    IF v_persona IS NULL THEN
        RETURN 0;
    END IF;

    SELECT count(*)::integer,
           coalesce(jsonb_agg(jsonb_build_object('summary', m.summary) ORDER BY m.id), '[]'::jsonb)
      INTO v_count, v_payload
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.relationship_id = p_relationship_id
       AND m.status = 'ACCEPTED'
       AND m.scope = 'RELATIONSHIP'
       AND m.deleted_at IS NULL;
    IF v_count IS NULL OR v_count <= 0 THEN
        RETURN 0;
    END IF;

    INSERT INTO vc.memory_import_bundle(owner_user_id, persona_ref, item_count, payload)
    VALUES (p_owner_user_id, v_persona, v_count, v_payload)
    ON CONFLICT (owner_user_id, persona_ref) DO UPDATE
        SET item_count = EXCLUDED.item_count,
            payload = EXCLUDED.payload,
            created_at = now();
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION vc.preview_importable_memories(
    p_owner_user_id bigint,
    p_persona_ref   text
)
    RETURNS TABLE(out_persona_ref text, out_item_count integer, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'preview_importable_memories: owner_user_id is required';
    END IF;
    IF p_persona_ref IS NULL OR btrim(p_persona_ref) = '' THEN
        RAISE EXCEPTION 'preview_importable_memories: persona_ref is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'preview_importable_memories: owner_user_id must match server-trusted context';
    END IF;

    RETURN QUERY
        SELECT b.persona_ref, b.item_count, b.created_at
          FROM vc.memory_import_bundle b
         WHERE b.owner_user_id = p_owner_user_id
           AND b.persona_ref = p_persona_ref;
END;
$$;

CREATE OR REPLACE FUNCTION vc.import_memories_to_relationship(
    p_owner_user_id   bigint,
    p_relationship_id bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_persona text;
    v_payload jsonb;
    v_item    jsonb;
    v_summary text;
    v_id      bigint;
    v_count   integer := 0;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'import_memories_to_relationship: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'import_memories_to_relationship: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'import_memories_to_relationship: owner_user_id must match server-trusted context';
    END IF;

    SELECT r.persona_ref INTO v_persona
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.id = p_relationship_id;
    IF v_persona IS NULL THEN
        RETURN -1;
    END IF;

    SELECT b.payload INTO v_payload
      FROM vc.memory_import_bundle b
     WHERE b.owner_user_id = p_owner_user_id
       AND b.persona_ref = v_persona;
    IF v_payload IS NULL THEN
        RETURN 0;
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload)
    LOOP
        v_summary := btrim(v_item ->> 'summary');
        IF v_summary IS NULL OR v_summary = '' THEN
            CONTINUE;
        END IF;
        v_id := nextval('vc.memory_id_seq');
        INSERT INTO vc.memory_item(
            owner_user_id, id, relationship_id, scope, summary, status)
        VALUES (
            p_owner_user_id, v_id, p_relationship_id, 'RELATIONSHIP', v_summary, 'ACCEPTED');
        INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref)
        VALUES (p_owner_user_id, nextval('vc.memory_id_seq'), v_id, 'import:archive');
        v_count := v_count + 1;
    END LOOP;

    DELETE FROM vc.memory_import_bundle
     WHERE owner_user_id = p_owner_user_id
       AND persona_ref = v_persona;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION vc.discard_importable_memories(
    p_owner_user_id bigint,
    p_persona_ref   text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'discard_importable_memories: owner_user_id is required';
    END IF;
    IF p_persona_ref IS NULL OR btrim(p_persona_ref) = '' THEN
        RAISE EXCEPTION 'discard_importable_memories: persona_ref is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'discard_importable_memories: owner_user_id must match server-trusted context';
    END IF;

    DELETE FROM vc.memory_import_bundle
     WHERE owner_user_id = p_owner_user_id
       AND persona_ref = p_persona_ref;
    RETURN TRUE;
END;
$$;

DROP FUNCTION IF EXISTS vc.reset_relationship(bigint, bigint);
CREATE OR REPLACE FUNCTION vc.reset_relationship(
    p_owner_user_id     bigint,
    p_relationship_id   bigint,
    p_retain_importable boolean DEFAULT false
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'reset_relationship: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'reset_relationship: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'reset_relationship: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1
       FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id
        AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF p_retain_importable THEN
        PERFORM vc.snapshot_importable_memories(p_owner_user_id, p_relationship_id);
    END IF;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
               AND c.relationship_id = p_relationship_id
       );

    DELETE FROM vc.conversation
     WHERE owner_user_id = p_owner_user_id
       AND relationship_id = p_relationship_id;
    DELETE FROM vc.memory_item
     WHERE owner_user_id = p_owner_user_id
       AND relationship_id = p_relationship_id;
    DELETE FROM vc.reminder
     WHERE owner_user_id = p_owner_user_id
       AND relationship_id = p_relationship_id;
    RETURN TRUE;
END;
$$;

DROP FUNCTION IF EXISTS vc.delete_relationship(bigint, bigint);
CREATE OR REPLACE FUNCTION vc.delete_relationship(
    p_owner_user_id     bigint,
    p_relationship_id   bigint,
    p_retain_importable boolean DEFAULT false
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_relationship: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'delete_relationship: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_relationship: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1
       FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id
        AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF p_retain_importable THEN
        PERFORM vc.snapshot_importable_memories(p_owner_user_id, p_relationship_id);
    END IF;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
               AND c.relationship_id = p_relationship_id
       );

    DELETE FROM vc.relationship
     WHERE owner_user_id = p_owner_user_id
       AND id = p_relationship_id;
    RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.snapshot_importable_memories(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.preview_importable_memories(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.import_memories_to_relationship(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.discard_importable_memories(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.reset_relationship(bigint, bigint, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.delete_relationship(bigint, bigint, boolean) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.snapshot_importable_memories(bigint, bigint),
                vc.preview_importable_memories(bigint, text),
                vc.import_memories_to_relationship(bigint, bigint),
                vc.discard_importable_memories(bigint, text),
                vc.reset_relationship(bigint, bigint, boolean),
                vc.delete_relationship(bigint, bigint, boolean)
    TO vc_api;
