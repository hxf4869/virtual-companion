-- TASK-0024 V9: Relationship lifecycle and the activeCompanionLimit=1 invariant.
--
-- The vc.relationship table (created in V2 with an `active` flag) had no
-- database-level cap on how many relationships a single owner could hold
-- ACTIVE at once. The Technical Alpha contract limits each user to exactly one
-- active Companion (activeCompanionLimit=1), so this migration makes that
-- invariant structural rather than application-enforced.
--
-- The load-bearing object is a PARTIAL UNIQUE INDEX:
--   CREATE UNIQUE INDEX ... ON vc.relationship (owner_user_id) WHERE active;
-- Under READ COMMITTED a second concurrent INSERT/UPDATE that would create a
-- second active row for the same owner blocks on this index, then fails with
-- unique_violation once the first transaction commits. The index is the hard
-- invariant; no application bug or race can produce two active companions.
--
-- Five SECURITY DEFINER functions provide the lifecycle API the OpenAPI contract
-- exposes (create / get / list / activate / deactivate). create_relationship and
-- activate_relationship take a per-owner advisory lock so the
-- deactivate-then-activate pair never races a concurrent sibling and always
-- returns a clean result; the partial unique index remains the backstop.
-- Cross-owner get/activate resolve to no row (FORCE RLS + the explicit owner
-- predicate) and therefore never disclose existence: the application maps an
-- empty result to NOT_FOUND_OR_FORBIDDEN (INV-TENANT-001).
--
-- Output columns of RETURNS TABLE functions use the out_ prefix so the names
-- never shadow the table columns inside the body (TASK-0017 lesson). Every new
-- function defaults to PUBLIC EXECUTE; this migration revokes PUBLIC and grants
-- only vc_api (TASK-0016 P0 class), matching the V7/V8 baseline.

SET search_path TO vc, public;

-- ---------------------------------------------------------------------------
-- activeCompanionLimit=1: at most one ACTIVE relationship per owner. This
-- partial unique index is the sole authority for the invariant; a dormant
-- (active=false) relationship never conflicts, so an owner may hold several
-- relationships but only ever one active Companion.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS relationship_one_active_per_owner
    ON vc.relationship (owner_user_id)
    WHERE active;

-- Dedicated id sequence for the relationship lifecycle, mirroring the V6
-- generation/message sequences. GRANT to the four runtime roles for parity with
-- vc.finalize_row_id_seq (V7); the SECURITY DEFINER functions consume it as the
-- table owner, and direct grants keep ad-hoc role use consistent.
CREATE SEQUENCE IF NOT EXISTS vc.relationship_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.relationship_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- create_relationship: establish a new ACTIVE relationship for the owner,
-- atomically deactivating any currently active relationship so the single-active
-- invariant holds and creation always succeeds (Alpha: the newest Companion
-- becomes active; the previous one goes dormant and may be re-activated). The
-- per-owner advisory lock serializes concurrent creates/activations so the pair
-- never hits the partial unique index as a hard error; the index is still the
-- authoritative backstop. Returns the new relationship id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_relationship(
    p_owner_user_id bigint,
    p_persona_ref   text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'create_relationship: owner_user_id is required';
    END IF;
    IF p_persona_ref IS NULL OR btrim(p_persona_ref) = '' THEN
        RAISE EXCEPTION 'create_relationship: persona_ref is required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);

    -- Serialize per-owner lifecycle mutations. Collisions across owners only
    -- over-serialize and never affect correctness; the partial unique index is
    -- the invariant, the lock only yields clean non-error returns.
    PERFORM pg_advisory_xact_lock(hashtext('vc.relationship.active:' || p_owner_user_id::text));

    -- Deactivate the owner's current active Companion (at most one under Alpha).
    UPDATE vc.relationship
       SET active = false
     WHERE owner_user_id = p_owner_user_id
       AND active;

    v_id := nextval('vc.relationship_id_seq');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (p_owner_user_id, v_id, p_persona_ref, true);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_relationship: return the relationship if it belongs to the caller, else
-- no row. The explicit owner predicate plus FORCE RLS means a cross-owner lookup
-- resolves to nothing and the application maps that to NOT_FOUND_OR_FORBIDDEN,
-- never disclosing whether the resource exists.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS TABLE(out_id bigint, out_persona_ref text,
                  out_active boolean, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_rel_id IS NULL THEN
        RAISE EXCEPTION 'get_relationship: owner_user_id and relationship id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
           AND r.id = p_rel_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_relationships: return every relationship owned by the caller (active and
-- dormant). RLS-scoped to the caller's owner_user_id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_relationships(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_persona_ref text,
                  out_active boolean, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'list_relationships: owner_user_id is required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    RETURN QUERY
        SELECT r.id, r.persona_ref, r.active, r.created_at
          FROM vc.relationship r
         WHERE r.owner_user_id = p_owner_user_id
         ORDER BY r.created_at, r.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- activate_relationship: make the target relationship the owner's single active
-- Companion, atomically deactivating any other active relationship. The target
-- must belong to the caller; a foreign or absent id resolves to no row locked
-- and raises, which the application maps to NOT_FOUND_OR_FORBIDDEN. The advisory
-- lock serializes against concurrent create/activate for the same owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.activate_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_rel_id IS NULL THEN
        RAISE EXCEPTION 'activate_relationship: owner_user_id and relationship id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    PERFORM pg_advisory_xact_lock(hashtext('vc.relationship.active:' || p_owner_user_id::text));

    -- Lock the target row and confirm ownership (FOR UPDATE prevents a
    -- concurrent mutation from changing it under us). A foreign/absent id
    -- matches nothing under RLS, so existence is never disclosed.
    PERFORM 1
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.id = p_rel_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'activate_relationship: relationship % not found for owner %',
            p_rel_id, p_owner_user_id;
    END IF;

    -- Deactivate every other active relationship, then activate the target. The
    -- partial unique index is satisfied throughout: after the first UPDATE no
    -- *other* row is active, so setting the target active yields exactly one.
    UPDATE vc.relationship
       SET active = false
     WHERE owner_user_id = p_owner_user_id
       AND active
       AND id <> p_rel_id;
    UPDATE vc.relationship
       SET active = true
     WHERE owner_user_id = p_owner_user_id
       AND id = p_rel_id;
    RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_relationship: set the caller's relationship inactive (zero active
-- Companions is permitted). Returns true when an owned row was updated, false
-- when the id is foreign or absent (existence still not disclosed). Idempotent.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.deactivate_relationship(
    p_owner_user_id bigint,
    p_rel_id        bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_rel_id IS NULL THEN
        RAISE EXCEPTION 'deactivate_relationship: owner_user_id and relationship id are required';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    UPDATE vc.relationship
       SET active = false
     WHERE owner_user_id = p_owner_user_id
       AND id = p_rel_id;
    RETURN FOUND;
END;
$$;

-- Every new SECURITY DEFINER function defaults to PUBLIC EXECUTE. Revoke it so
-- only the explicitly granted runtime role may call them (TASK-0016 P0 class).
REVOKE EXECUTE ON FUNCTION vc.create_relationship(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_relationship(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_relationships(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.activate_relationship(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.deactivate_relationship(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.create_relationship(bigint, text),
              vc.get_relationship(bigint, bigint),
              vc.list_relationships(bigint),
              vc.activate_relationship(bigint, bigint),
              vc.deactivate_relationship(bigint, bigint)
    TO vc_api;
