-- TASK-0028 V12: Memory candidate management API.
--
-- TASK-0027 (V11) made memory_item and memory_evidence a Canonical Memory store
-- whose ACCEPTED records can be produced only by the user confirmation path, and
-- funneled all access through SECURITY DEFINER functions by revoking direct DML
-- (including SELECT) from every runtime role. That left two API-shaped gaps:
--
--   * user content edit -- there was no function to edit a memory's summary, and
--     direct UPDATE is revoked, so the candidate/canonical content could not be
--     corrected by the user at all;
--   * source Evidence read -- create_memory_candidate persists an evidence chain
--     but no function returned it, so the API could not show why a candidate was
--     proposed.
--
-- This migration closes both gaps with two new SECURITY DEFINER functions and
-- makes delete_memory match the idempotency its own V11 header already claimed.
-- It changes no table structure and no privilege-revocation set: runtime roles
-- still have no direct DML on memory_item/memory_evidence, and the canonical
-- confirmation gate (INV-MEM-001/002) is untouched -- update_memory never
-- changes status, so a record still reaches ACCEPTED only via
-- confirm_memory_candidate.

SET search_path TO vc, public;

-- ---------------------------------------------------------------------------
-- update_memory: edit the summary of an owned, non-deleted, editable memory.
-- Status-agnostic in the sense that it ONLY writes summary -- it never changes
-- status, so it cannot promote a candidate to canonical or revive a dead one.
-- Editable statuses are PENDING_CONFIRMATION (correct before confirming) and
-- ACCEPTED (refine a canonical record); REJECTED/EXPIRED are dead ends and are
-- rejected. A foreign, absent or deleted id raises without disclosing existence
-- (the message echoes only the caller's own values). The UPDATE is naturally
-- idempotent: applying the same summary twice leaves the row unchanged and
-- returns TRUE both times. FOR UPDATE serializes concurrent edits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.update_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint,
    p_summary       text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status  text;
    v_deleted timestamptz;
BEGIN
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'update_memory: owner_user_id and memory_id are required';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'update_memory: summary is required and must not be blank';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT m.status, m.deleted_at INTO v_status, v_deleted
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

    UPDATE vc.memory_item
       SET summary = p_summary
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_memory_evidence: return the source Evidence chain of an owned, non-deleted
-- memory. A foreign, absent or deleted id resolves to no rows, which is
-- indistinguishable from a real memory that simply carries no evidence, so
-- existence is never disclosed. The join on memory_item with deleted_at IS NULL
-- guarantees the evidence of a soft-deleted memory is not returned.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_memory_evidence(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS TABLE(out_id bigint, out_source_ref text, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'list_memory_evidence: owner_user_id and memory_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    RETURN QUERY
        SELECT e.id, e.source_ref, e.created_at
          FROM vc.memory_evidence e
          JOIN vc.memory_item m
            ON m.owner_user_id = e.owner_user_id
           AND m.id = e.memory_item_id
         WHERE e.owner_user_id = p_owner_user_id
           AND e.memory_item_id = p_memory_id
           AND m.deleted_at IS NULL
         ORDER BY e.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_memory: soft-delete (sets deleted_at). The V11 header already stated
-- "Idempotent on already-deleted rows", but the V11 implementation raised on a
-- second delete because a single UPDATE ... WHERE deleted_at IS NULL could not
-- distinguish "owned but already deleted" from "foreign/absent". This replacement
-- separates the two: a row that exists and is owned is locked (FOR UPDATE) and
-- the call returns TRUE whether or not the soft-delete UPDATE touches any rows
-- (idempotent on already-deleted), while a foreign or absent id still raises
-- without disclosing existence. Cross-owner isolation is unchanged (the
-- existence predicate is owner_user_id), so test 33 still passes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.delete_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'delete_memory: owner_user_id and memory_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Lock the owned row if it exists. A foreign or absent id resolves to no
    -- row; existence is not disclosed.
    PERFORM 1
      FROM vc.memory_item
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'delete_memory: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;

    -- Idempotent: if already soft-deleted this affects 0 rows and we still
    -- return TRUE (matching the V11 documented intent).
    UPDATE vc.memory_item
       SET deleted_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
       AND deleted_at IS NULL;
    RETURN TRUE;
END;
$$;

-- The two new functions default to PUBLIC EXECUTE; revoke it and grant only
-- vc_api, matching the V7-V11 baseline (TASK-0016 P0 class). delete_memory keeps
-- the grants V11 already established (CREATE OR REPLACE preserves EXECUTE
-- privileges for an unchanged signature).
REVOKE EXECUTE ON FUNCTION vc.update_memory(bigint, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_memory_evidence(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.update_memory(bigint, bigint, text),
              vc.list_memory_evidence(bigint, bigint)
    TO vc_api;
