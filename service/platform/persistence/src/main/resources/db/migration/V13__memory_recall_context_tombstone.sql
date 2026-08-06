-- TASK-0029 V13: Cross-conversation recall, Context source scoping and the
-- deletion tombstone.
--
-- TASK-0027/0028 (V11/V12) made memory_item a Canonical Memory store whose
-- ACCEPTED records are reached only by user confirmation, with direct DML
-- revoked so all access flows through SECURITY DEFINER functions. This migration
-- adds the READ path that turns that store into injectable context:
-- recall_memory.
--
-- recall_memory is the deterministic, ContextPlan-facing read. It returns ONLY
-- confirmed (status = 'ACCEPTED'), non-deleted memory for one owner and one
-- relationship -- never a pending/rejected candidate, never a soft-deleted row.
-- RELATIONSHIP-scoped memory is recalled across conversations (the cross-session
-- context); SESSION-scoped memory is recalled only when the caller binds the
-- conversation it is generating for. The result is source-grouped (RELATIONSHIP
-- before SESSION) and deterministic (created_at, id), then capped by a budget
-- clamped to [1, 100] -- the entries upper bound that mirrors ContextBudget; a
-- runtime consumer performs exact token budgeting on this deterministic slice.
--
-- The tombstone is structural: recall reads the live table with
-- deleted_at IS NULL, so a deleted memory can never be recalled. There is no
-- separate vector or cache store for deleted data to hide in and revive from
-- (the forbidden case). A cross-owner or cross-relationship recall resolves to
-- no rows, indistinguishable from an empty relationship, so existence is never
-- disclosed (INV-TENANT-001).
--
-- No table structure or privilege-revocation-set change: runtime roles still
-- have no direct DML on memory_item/memory_evidence, and the canonical
-- confirmation gate is untouched (recall is a pure read of ACCEPTED rows; it
-- never creates candidates or changes status).

SET search_path TO vc, public;

-- ---------------------------------------------------------------------------
-- recall_memory: deterministic recall of confirmed memory for ContextPlan
-- injection. See migration header for the source/budget/tombstone contract.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.recall_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_conversation_id bigint DEFAULT NULL,
    p_max_entries     int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_conversation_id bigint, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_limit int;
BEGIN
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'recall_memory: owner_user_id and relationship_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Budget clamp to a safe band. The entries upper bound mirrors the
    -- ContextBudget shape; exact token budgeting is the runtime consumer's job.
    v_limit := LEAST(GREATEST(p_max_entries, 1), 100);

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.conversation_id, m.created_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
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

-- recall_memory defaults to PUBLIC EXECUTE; revoke it and grant only vc_api,
-- matching the V7-V12 baseline (TASK-0016 P0 class).
REVOKE EXECUTE ON FUNCTION vc.recall_memory(bigint, bigint, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.recall_memory(bigint, bigint, bigint, int) TO vc_api;
