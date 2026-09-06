-- V128: close/revoke vs auto-save write ordering (Codex audit round 2,
-- defect 2).
--
-- The write-phase guards of the auto-save path (CreateAutoSavedMemory
-- re-reads pref/consent/no_memory inside its insert transaction) were still
-- check-then-act under READ COMMITTED: a write transaction that had read
-- pref ON + consent OK could pause before the insert, the owner could close
-- the switch or withdraw a consent in a second transaction, and the paused
-- write would still land its memory AFTER the close had committed and
-- returned. This migration closes that window too: the guard read becomes
-- vc.guard_auto_save_source (SELECT ... FOR SHARE OF m on the source row,
-- pinning it against the flip's UPDATE).
--
-- This migration closes the pref/consent window IN THE DATABASE with a
-- per-owner transactional advisory lock, mirroring V113's export pointer
-- barrier:
--   * vc.memory_write_barrier — takes the lock; CreateAutoSavedMemory's Go
--     transaction calls it as the FIRST statement (before any guard read).
--   * vc.set_memory_auto_save_pref — takes the SAME lock before its upsert.
--   * vc.record_consent (the PUT /consents entry) — takes the SAME lock
--     before its append.
-- The two sides therefore serialize: either the write commits first (the
-- close returns only afterwards — nothing in flight can still land a
-- memory), or the close commits first and the write's re-reads refuse. The
-- lock is transaction-scoped, so a crashed holder cannot wedge the owner.
--
-- Lock key derivation: this barrier and V113's export_pointer_barrier share
-- the two-int advisory space without overlapping. V113 uses first key
-- owner>>32, which is always >= 0 for a positive bigint owner; the barrier
-- uses first key = -(owner>>32) - 1 (always negative, a bijection on the
-- high word) with the same lossless fold of the low 32 bits, so the two
-- schemes can never collide on any key pair and two different owners never
-- share a barrier. The single-int pg_advisory_lock(hashtext(...)) locks used
-- elsewhere live in the SAME two-int space: PostgreSQL lifts a negative
-- bigint key to (first key = -1, second key = the folded negative int), and
-- for an owner below 2^32 whose low word reaches >= 2^31 this barrier also
-- produces (first key = -1, second key = a negative int), so the two key
-- DOMAINS overlap in theory. They are disjoint only in practice: owner ids
-- come from a small positive sequence, so the folded low word stays far
-- below 2^31 and cannot equal any negative hashtext value. Only advisory
-- locks are touched, so this is a plain (non-definer) function closed to
-- PUBLIC.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.memory_write_barrier(p_owner_user_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SET search_path = pg_catalog
AS $$
DECLARE
    v_hi bigint;
    v_lo bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'memory_write_barrier: owner_user_id is required';
    END IF;
    v_hi := -(p_owner_user_id >> 32) - 1;
    v_lo := p_owner_user_id & 4294967295;
    PERFORM pg_advisory_xact_lock(
        v_hi::int,
        (v_lo - CASE WHEN v_lo >= 2147483648 THEN 4294967296 ELSE 0 END)::int);
END;
$$;

REVOKE ALL ON FUNCTION vc.memory_write_barrier(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_write_barrier(bigint)
    TO vc_api, vc_worker;

-- ---------------------------------------------------------------------------
-- The per-message guard read with its row pin. The FOR SHARE clause needs
-- table privileges the runtime roles deliberately do NOT hold on vc.message
-- (any row-lock mode requires UPDATE-level privilege; the roles only get
-- SELECT), so the pinned read is exposed as this SECURITY DEFINER helper:
-- same row-level SHARE lock, held until the calling transaction ends, which
-- is what makes the V57 tombstone flip (UPDATE vc.message SET no_memory)
-- wait behind an in-flight guard window. No rows for a foreign/absent id —
-- the caller keeps its not-found semantics.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.guard_auto_save_source(
    p_owner_user_id bigint,
    p_message_id    bigint
)
    RETURNS TABLE(out_no_memory boolean, out_incognito boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'guard_auto_save_source: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'guard_auto_save_source: owner_user_id must match server-trusted context';
    END IF;

    RETURN QUERY
        SELECT m.no_memory, c.incognito
          FROM vc.message m
          JOIN vc.conversation c
            ON c.owner_user_id = m.owner_user_id AND c.id = m.conversation_id
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_message_id
         FOR SHARE OF m;
END;
$$;

REVOKE ALL ON FUNCTION vc.guard_auto_save_source(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.guard_auto_save_source(bigint, bigint)
    TO vc_api, vc_worker;

-- ---------------------------------------------------------------------------
-- The kill switch takes the owner write barrier before its upsert, so it
-- waits for every in-flight auto-save write transaction (which take the same
-- lock first) to end, and every write starting afterwards reads the closed
-- state. Signature and semantics unchanged (CREATE OR REPLACE keeps the V66
-- grants; restated below per convention).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.set_memory_auto_save_pref(
    p_owner_user_id bigint,
    p_enabled       boolean
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'set_memory_auto_save_pref: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'set_memory_auto_save_pref: owner_user_id must match server-trusted context';
    END IF;
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'set_memory_auto_save_pref: enabled is required';
    END IF;

    -- V128: same per-owner barrier the auto-save write path takes first.
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    INSERT INTO vc.memory_auto_save_pref(owner_user_id, enabled, updated_at)
    VALUES (p_owner_user_id, p_enabled, now())
    ON CONFLICT (owner_user_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            updated_at = now();
    RETURN p_enabled;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.set_memory_auto_save_pref(bigint, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.set_memory_auto_save_pref(bigint, boolean) TO vc_api;

-- ---------------------------------------------------------------------------
-- The consent write path (PUT /consents -> vc.record_consent) takes the same
-- owner write barrier before its append, so a withdrawal waits for in-flight
-- auto-save writes and refuses nothing afterwards — their guard re-read of
-- the consents then sees the withdrawal. Signature and semantics unchanged
-- from V41 (grants restated per convention).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_consent(
    p_owner_user_id bigint,
    p_consent_type  text,
    p_version       text,
    p_granted       boolean
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_consent: owner_user_id is required';
    END IF;
    IF p_consent_type NOT IN ('SERVICE_TERMS', 'PRIVACY_POLICY', 'AI_CONTENT_NOTICE',
            'THIRD_PARTY_MODEL_PROCESSING', 'SENSITIVE_DATA_PROCESSING',
            'EMERGENCY_CONTACT', 'MODEL_TRAINING', 'PUSH_NOTIFICATION') THEN
        RAISE EXCEPTION 'record_consent: unapproved consent type';
    END IF;
    IF p_version IS NULL OR btrim(p_version) = '' OR length(p_version) > 64 THEN
        RAISE EXCEPTION 'record_consent: version must be 1..64 characters';
    END IF;
    IF p_granted IS NULL THEN
        RAISE EXCEPTION 'record_consent: granted is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_consent: owner_user_id must match server-trusted context';
    END IF;

    -- V128: same per-owner barrier the auto-save write path takes first.
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    v_id := nextval('vc.consent_record_id_seq');
    INSERT INTO vc.consent_record
        (owner_user_id, id, consent_type, version, granted, granted_at, revoked_at)
    VALUES
        (p_owner_user_id, v_id, p_consent_type, btrim(p_version), p_granted,
         now(), CASE WHEN p_granted THEN NULL ELSE now() END);
    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.record_consent(bigint, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_consent(bigint, text, text, boolean) TO vc_api;
