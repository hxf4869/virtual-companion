-- 2026-09-06 remediation round, N-02 (F-02): the turn context seed gains an
-- effective-memory selection entry.
--
-- LoadSeed previously reused the management read vc.list_memory (which
-- returns every non-deleted row of the relationship, superseded ones
-- included, oldest first) and filtered only status/deleted/SESSION-binding in
-- Go. Superseded and expired rows therefore kept entering the provider
-- context after the UI had already stopped showing them, and the
-- relationship's memoryShareScope preference never gated the read.
--
-- This selection entry applies, in SQL, BEFORE any ordering/truncation:
--   ACCEPTED, not deleted, not superseded (V68 chain), due event memories
--   lazily expired (the V68 read pattern), and the scope rule
--     memoryShareScope = 'RELATIONSHIP' (default):
--         RELATIONSHIP-scope memories plus this conversation's SESSION ones;
--     memoryShareScope = 'SESSION':
--         only this conversation's SESSION memories.
-- Auto-save keeps storing RELATIONSHIP scope (memory-recall-contract); this
-- migration changes the read side only and does not migrate stored rows.
-- Ordering keeps the established (created_at, id) semantics; the model
-- window choice itself is N-13's scope. p_max_entries is capped at 100 and
-- must stay >= the builder's context entry budget so the cut never changes
-- which memories the builder would have picked from a full read.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.go_select_recall_memories(
    p_owner_user_id    bigint,
    p_relationship_id  bigint,
    p_conversation_id  bigint,
    p_share_scope      text,
    p_max_entries      integer
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_conversation_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int;
BEGIN
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'go_select_recall_memories: owner_user_id and relationship_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_select_recall_memories: owner_user_id must match server-trusted context';
    END IF;

    -- Due event memories leave the effective set in the same read (V68
    -- pattern): a stale plan must not feed the context as a fresh fact.
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
        SELECT m.id, m.scope, m.summary, m.conversation_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND m.superseded_at IS NULL
           AND (
                (   p_share_scope IS DISTINCT FROM 'SESSION'
                    AND (
                         m.scope = 'RELATIONSHIP'
                      OR (    m.scope = 'SESSION'
                          AND p_conversation_id IS NOT NULL
                          AND m.conversation_id = p_conversation_id)
                    )
                )
                OR
                (   p_share_scope = 'SESSION'
                    AND m.scope = 'SESSION'
                    AND p_conversation_id IS NOT NULL
                    AND m.conversation_id = p_conversation_id
                )
           )
         ORDER BY m.created_at, m.id
         LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_select_recall_memories(bigint, bigint, bigint, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_select_recall_memories(bigint, bigint, bigint, text, integer) TO vc_api;
