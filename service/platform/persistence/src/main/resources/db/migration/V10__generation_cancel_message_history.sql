-- TASK-0025 V10: Generation cancel and paginated message history.
--
-- Backs the Chat/Generation/History API contract. Two new SECURITY DEFINER
-- functions extend the generation lifecycle and the read side:
--
--   * cancel_generation — transitions a cancellable non-terminal generation to
--     CANCELLED via the catalog double-hop (non-terminal -> CANCEL_REQUESTED ->
--     CANCELLED). The generation-states catalog defines CANCEL_REQUESTED as the
--     only intermediate and lists no direct non-terminal -> CANCELLED edge, and
--     COMMITTING has no CANCEL_REQUESTED edge, so only CREATED, INPUT_REVIEW,
--     QUEUED, IN_PROGRESS, WAITING_FOR_CAPACITY and FINAL_REVIEW may cancel.
--     Terminal states and COMMITTING are rejected. A foreign/absent id resolves
--     to no row under FORCE RLS and raises, never disclosing existence.
--
--   * list_messages — keyset pagination over vc.message by (owner_user_id, id)
--     with an after-id cursor and a clamped limit. The composite ownership FK
--     (owner_user_id, conversation_id) -> conversation guarantees a message can
--     never reference a conversation owned by another user, so a cross-owner or
--     cross-conversation lookup returns nothing (NOT_FOUND_OR_FORBIDDEN).
--
-- Both functions follow the V8/V9 baseline: SECURITY DEFINER, SET search_path =
-- vc, public, set_config binds vc.current_owner_id, RETURNS TABLE output columns
-- use the out_ prefix, REVOKE PUBLIC and GRANT EXECUTE only to vc_api. FORCE RLS
-- is already established on vc.generation and vc.message by V2; no new table or
-- role is introduced and no executed migration is modified.

SET search_path TO vc, public;

-- ---------------------------------------------------------------------------
-- cancel_generation: move a cancellable non-terminal generation to CANCELLED.
-- Honors the catalog transition graph (non-terminal -> CANCEL_REQUESTED ->
-- CANCELLED; COMMITTING has no cancel edge). Returns the terminal status
-- 'CANCELLED'. A foreign/absent id raises (existence hidden). An already
-- terminal or non-cancellable state raises. The target row is locked FOR UPDATE
-- so the ownership check and the transition cannot be split by a concurrent
-- writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.cancel_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'cancel_generation: owner_user_id and generation_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'cancel_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- Cancellable states per the catalog transition graph. COMMITTING and every
    -- terminal state (INPUT_BLOCKED, COMPLETED, COMPLETED_FALLBACK, CANCELLED,
    -- OUTPUT_BLOCKED, FAILED_FINAL) have no CANCEL_REQUESTED edge.
    IF v_status NOT IN (
        'CREATED', 'INPUT_REVIEW', 'QUEUED', 'IN_PROGRESS',
        'WAITING_FOR_CAPACITY', 'FINAL_REVIEW'
    ) THEN
        RAISE EXCEPTION 'cancel_generation: generation in state % is not cancellable',
            v_status;
    END IF;

    -- Catalog double-hop: both edges are valid, so the transition is observable
    -- only as the terminal CANCELLED state to the caller.
    UPDATE vc.generation
       SET status = 'CANCEL_REQUESTED'
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;
    UPDATE vc.generation
       SET status = 'CANCELLED'
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

    RETURN 'CANCELLED';
END;
$$;

-- ---------------------------------------------------------------------------
-- list_messages: keyset pagination over a conversation's messages, newest-aware
-- stable ordering by the composite key (owner_user_id, id). The after-id cursor
-- and clamped limit make pagination deterministic; the caller passes the last id
-- seen as the next cursor. The composite ownership FK guarantees a message can
-- never reference another owner's conversation, so a cross-owner or cross-
-- conversation query resolves to no row (existence never disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_messages(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_role text,
                  out_content text, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_conversation_id IS NULL THEN
        RAISE EXCEPTION 'list_messages: owner_user_id and conversation_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Clamp the page size into a safe band; defaults are applied for NULL/empty.
    IF p_limit IS NULL OR p_limit < 1 THEN
        p_limit := 50;
    END IF;
    IF p_limit > 100 THEN
        p_limit := 100;
    END IF;
    IF p_after_id IS NULL THEN
        p_after_id := 0;
    END IF;

    RETURN QUERY
        SELECT m.id, m.role, m.content, m.created_at
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.conversation_id = p_conversation_id
           AND m.id > p_after_id
         ORDER BY m.id
         LIMIT p_limit;
END;
$$;

-- Every new SECURITY DEFINER function defaults to PUBLIC EXECUTE. Revoke it and
-- grant only vc_api (TASK-0016 P0 class), matching the V7/V8/V9 baseline.
REVOKE EXECUTE ON FUNCTION vc.cancel_generation(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_messages(bigint, bigint, bigint, integer) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.cancel_generation(bigint, bigint),
              vc.list_messages(bigint, bigint, bigint, integer)
    TO vc_api;
