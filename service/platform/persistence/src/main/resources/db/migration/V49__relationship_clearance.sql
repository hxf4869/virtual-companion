-- COMP-CLEAR V49: Companion reset / delete (FR-COMP-004).
--
-- Adds three owner-scoped SECURITY DEFINER functions in the V17 trusted-owner
-- pattern (p_owner_user_id must match vc.current_owner_id()):
--   * preview_relationship_clearance — read-only counts of conversations,
--     memory items and reminders under one owned Companion.
--   * reset_relationship — cancel in-flight GENERATION / MEMORY_EXTRACT work
--     items, then delete the conversation tree, relationship-level memories
--     and reminders. The relationship row and its structured preferences
--     (including presentation fields) stay. Account-level rows are untouched.
--   * delete_relationship — the same cancel + relationship DELETE; conversation,
--     memory_item and reminder cascade via existing ON DELETE CASCADE FKs.
-- Preview returns no rows for a foreign or absent id. Reset / delete return
-- FALSE in that case so existence is never disclosed at the API layer.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- preview_relationship_clearance: factual scope counts for one owned Companion.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.preview_relationship_clearance(
    p_owner_user_id   bigint,
    p_relationship_id bigint
)
    RETURNS TABLE(
        out_conversation_count bigint,
        out_memory_count       bigint,
        out_reminder_count     bigint
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'preview_relationship_clearance: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'preview_relationship_clearance: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'preview_relationship_clearance: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1
       FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id
        AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT
            (SELECT count(*)::bigint
               FROM vc.conversation c
              WHERE c.owner_user_id = p_owner_user_id
                AND c.relationship_id = p_relationship_id),
            (SELECT count(*)::bigint
               FROM vc.memory_item m
              WHERE m.owner_user_id = p_owner_user_id
                AND m.relationship_id = p_relationship_id),
            (SELECT count(*)::bigint
               FROM vc.reminder rem
              WHERE rem.owner_user_id = p_owner_user_id
                AND rem.relationship_id = p_relationship_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- reset_relationship: keep the Companion row + prefs; clear the domain.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.reset_relationship(
    p_owner_user_id   bigint,
    p_relationship_id bigint
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

    -- GENERATION / MEMORY_EXTRACT both reference the generation id. Cancel
    -- in-flight items before the conversation tree is deleted so a worker
    -- never retries a dangling ref into dead-letter. DATA_EXPORT is
    -- account-scoped and is not cancelled here.
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

-- ---------------------------------------------------------------------------
-- delete_relationship: cancel in-flight work, then delete the Companion row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.delete_relationship(
    p_owner_user_id   bigint,
    p_relationship_id bigint
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

REVOKE EXECUTE ON FUNCTION vc.preview_relationship_clearance(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.reset_relationship(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.delete_relationship(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.preview_relationship_clearance(bigint, bigint),
                vc.reset_relationship(bigint, bigint),
                vc.delete_relationship(bigint, bigint)
    TO vc_api;
