-- TASK-0027 V11: Canonical Memory lifecycle, evidence chain and ownership isolation.
--
-- vc.memory_item and vc.memory_evidence were created in V2 (FORCE RLS, composite
-- ownership via relationship). This migration turns them into the Canonical
-- Memory store: a PostgreSQL truth whose ACCEPTED (canonical) records can be
-- produced ONLY by the user confirmation path, while model output may only create
-- PENDING_CONFIRMATION candidates (INV-MEM-001/002).
--
-- The structural enforcement is privilege revocation: INSERT/UPDATE/DELETE/SELECT
-- on memory_item and memory_evidence are revoked from every runtime role, so all
-- access flows through the SECURITY DEFINER functions below. list_memory scopes
-- reads by relationship_id, so one relationship can never read another's memory
-- (RLS alone only isolates by owner, and an owner may hold several
-- relationships). CASCADE integrity (FK ON DELETE) runs as the table owner and is
-- unaffected by the runtime-role revocation.
--
-- Alpha scope is enforced in create_memory_candidate: only SESSION and
-- RELATIONSHIP are accepted (ACCOUNT_PRIVATE/ACCOUNT_SHARED are not enabled in
-- Alpha). SESSION additionally requires a conversation binding per the
-- memory-scopes catalog; a CHECK makes that structural.

SET search_path TO vc, public;

-- ---------------------------------------------------------------------------
-- Bring memory_item up to the Canonical Memory model.
-- ---------------------------------------------------------------------------
ALTER TABLE vc.memory_item
    ADD COLUMN IF NOT EXISTS conversation_id bigint,
    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- SESSION memory is bound to a conversation (memory-scopes: SESSION requires
-- conversationId). Structural, so a buggy caller cannot persist an unbound
-- SESSION memory.
ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_session_requires_conversation;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_session_requires_conversation
    CHECK (scope <> 'SESSION' OR conversation_id IS NOT NULL);

-- A SESSION memory references its conversation through the composite ownership
-- chain; deleting the conversation cascades to its SESSION memory.
ALTER TABLE vc.memory_item
    DROP CONSTRAINT IF EXISTS memory_item_conversation_fk;
ALTER TABLE vc.memory_item
    ADD CONSTRAINT memory_item_conversation_fk
    FOREIGN KEY (owner_user_id, conversation_id)
    REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE;

-- Align the default with the catalog alphaModelCandidateInitialStatus. Existing
-- Alpha tables are empty (tests TRUNCATE), so the new default is safe.
ALTER TABLE vc.memory_item
    ALTER COLUMN status SET DEFAULT 'PENDING_CONFIRMATION';

-- Shared id sequence for memory_item and memory_evidence (mirrors
-- vc.finalize_row_id_seq / vc.relationship_id_seq).
CREATE SEQUENCE IF NOT EXISTS vc.memory_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.memory_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- Funnel ALL memory access through the SECURITY DEFINER functions. Runtime roles
-- lose direct DML (including SELECT) on memory_item and memory_evidence so that
-- relationship-scoped reads and the confirmation-only canonical path cannot be
-- bypassed. FK CASCADE integrity is owner-scoped and unaffected.
-- ---------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE
    ON vc.memory_item, vc.memory_evidence
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- create_memory_candidate: the ONLY way model output enters the store. Inserts a
-- PENDING_CONFIRMATION candidate (never ACCEPTED) with its evidence chain. Alpha
-- scope is enforced (SESSION/RELATIONSHIP only; SESSION requires a conversation).
-- Returns the new candidate id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_memory_candidate(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_scope           text,
    p_summary         text,
    p_conversation_id bigint DEFAULT NULL,
    p_evidence        text[] DEFAULT ARRAY[]::text[]
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
    v_evidence text;
BEGIN
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
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

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
        owner_user_id, id, relationship_id, scope, summary, status, conversation_id)
    VALUES (
        p_owner_user_id, v_id, p_relationship_id, p_scope, p_summary,
        'PENDING_CONFIRMATION', p_conversation_id);

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
-- confirm_memory_candidate: the ONLY path to a canonical (ACCEPTED) record. A
-- PENDING_CONFIRMATION candidate becomes ACCEPTED after the user confirms it
-- (INV-MEM-002). Any other status is rejected. A foreign/absent id raises
-- without disclosing existence.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.confirm_memory_candidate(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
    v_deleted timestamptz;
BEGIN
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'confirm_memory_candidate: owner_user_id and memory_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT m.status, m.deleted_at INTO v_status, v_deleted
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

    UPDATE vc.memory_item
       SET status = 'ACCEPTED'
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- reject_memory_candidate: a PENDING_CONFIRMATION candidate the user declined.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.reject_memory_candidate(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'reject_memory_candidate: owner_user_id and memory_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    SELECT m.status INTO v_status
      FROM vc.memory_item m
     WHERE m.owner_user_id = p_owner_user_id AND m.id = p_memory_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reject_memory_candidate: memory % not found for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    IF v_status <> 'PENDING_CONFIRMATION' THEN
        RAISE EXCEPTION 'reject_memory_candidate: memory % is not pending confirmation (status %)',
            p_memory_id, v_status;
    END IF;

    UPDATE vc.memory_item
       SET status = 'REJECTED'
     WHERE owner_user_id = p_owner_user_id AND id = p_memory_id;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_memory: soft-delete (sets deleted_at) on a canonical memory. Idempotent
-- on already-deleted rows. A foreign/absent id raises without disclosing
-- existence.
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

    UPDATE vc.memory_item
       SET deleted_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_memory_id
       AND deleted_at IS NULL;
    IF NOT FOUND THEN
        -- Either foreign/absent, or already deleted. Existence is not disclosed.
        RAISE EXCEPTION 'delete_memory: memory % not found (or already deleted) for owner %',
            p_memory_id, p_owner_user_id;
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_memory: relationship-scoped candidates/canonical memory. Deleted rows are
-- excluded unless explicitly requested. The relationship predicate plus FORCE RLS
-- means another owner (or another relationship) resolves to no rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_include_deleted boolean DEFAULT false
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_status text, out_conversation_id bigint,
                  out_deleted_at timestamptz, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'list_memory: owner_user_id and relationship_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.status, m.conversation_id,
               m.deleted_at, m.created_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND (p_include_deleted OR m.deleted_at IS NULL)
         ORDER BY m.created_at, m.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_memory: fetch one owned, non-deleted memory by id. A foreign/absent id
-- resolves to no row (existence not disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_memory(
    p_owner_user_id bigint,
    p_memory_id     bigint
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_scope text,
                  out_summary text, out_status text, out_conversation_id bigint,
                  out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_memory_id IS NULL THEN
        RAISE EXCEPTION 'get_memory: owner_user_id and memory_id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    RETURN QUERY
        SELECT m.id, m.relationship_id, m.scope, m.summary, m.status,
               m.conversation_id, m.created_at
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_memory_id
           AND m.deleted_at IS NULL;
END;
$$;

-- Every new SECURITY DEFINER function defaults to PUBLIC EXECUTE. Revoke it and
-- grant only vc_api (TASK-0016 P0 class), matching the V7-V10 baseline.
REVOKE EXECUTE ON FUNCTION vc.create_memory_candidate(bigint, bigint, text, text, bigint, text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.confirm_memory_candidate(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.reject_memory_candidate(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.delete_memory(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_memory(bigint, bigint, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_memory(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.create_memory_candidate(bigint, bigint, text, text, bigint, text[]),
              vc.confirm_memory_candidate(bigint, bigint),
              vc.reject_memory_candidate(bigint, bigint),
              vc.delete_memory(bigint, bigint),
              vc.list_memory(bigint, bigint, boolean),
              vc.get_memory(bigint, bigint)
    TO vc_api;
