-- RETENTION V70: versioned data_retention_policy + per-category purge SDs.
--
-- §16.7: concrete periods are a legal/platform/business decision — engineering
-- only guarantees that every category's period is VERSIONED in
-- vc.data_retention_policy and never hardcoded in code. The v1 rows seeded
-- here are DRAFT values pending Owner/legal review; a new policy_version is
-- appended (never UPDATEd) when the review lands, and the purge path always
-- reads the newest ACTIVE row per category (fail-closed when absent).
--
-- Categories (TODO R48) map to physical storage:
--   NORMAL_CHAT        -> vc.message (+ summary invalidation, see below)
--   DELETED_CHAT       -> no residue today: message/conversation deletes are
--                         physical cascades, so the purge returns 0; the row
--                         stays to keep the policy surface complete.
--   MEMORY_CANDIDATE   -> vc.memory_item status='PENDING_CONFIRMATION'
--   REJECTED_CANDIDATE -> vc.memory_item status='REJECTED'
--   MODEL_CALL_DETAIL  -> vc.provider_attempt + vc.generation_route
--   SAFETY_LOG         -> vc.safety_event (no FK by design)
--   EXPORT_RESIDUE     -> vc.export_request terminal rows (payload already
--                         cleared by the expire path)
--   STREAM_FRAGMENT    -> vc.realtime_event
--
-- Every purge is a SECURITY DEFINER function deleting ONLY by age/status so
-- runtime roles never need table-level DELETE (the V22 boundary pattern).
-- NORMAL_CHAT invalidates conversation summaries covering purged messages in
-- the same transaction (the V63 FR-CHAT-004 rule, set-based). All functions
-- fail closed on a NULL cutoff and are idempotent.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- Policy table: append-only versions, one row per (version, category).
-- System table: no RLS/owner dimension; runtime roles get no direct DML.
-- ---------------------------------------------------------------------------
CREATE TABLE vc.data_retention_policy (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    policy_version int    NOT NULL CHECK (policy_version >= 1),
    category       text   NOT NULL CHECK (category IN (
                       'NORMAL_CHAT', 'DELETED_CHAT', 'MEMORY_CANDIDATE',
                       'REJECTED_CANDIDATE', 'MODEL_CALL_DETAIL', 'SAFETY_LOG',
                       'EXPORT_RESIDUE', 'STREAM_FRAGMENT')),
    retain_days    int    NOT NULL CHECK (retain_days BETWEEN 1 AND 3650),
    active         boolean NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (policy_version, category)
);

REVOKE ALL ON vc.data_retention_policy
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- Draft v1 periods (§16.7: pending legal/platform confirmation — Owner review).
INSERT INTO vc.data_retention_policy (policy_version, category, retain_days) VALUES
    (1, 'NORMAL_CHAT',        365),
    (1, 'DELETED_CHAT',        30),
    (1, 'MEMORY_CANDIDATE',    90),
    (1, 'REJECTED_CANDIDATE',  30),
    (1, 'MODEL_CALL_DETAIL',  180),
    (1, 'SAFETY_LOG',         365),
    (1, 'EXPORT_RESIDUE',      30),
    (1, 'STREAM_FRAGMENT',     30);

-- ---------------------------------------------------------------------------
-- active_retention_days: effective days for one category = the newest ACTIVE
-- policy version. Fail-closed: an unknown or deactivated category raises.
-- ---------------------------------------------------------------------------
CREATE FUNCTION vc.active_retention_days(p_category text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_days int;
BEGIN
    IF p_category IS NULL OR p_category = '' THEN
        RAISE EXCEPTION 'active_retention_days: category is required';
    END IF;
    SELECT retain_days INTO v_days
      FROM vc.data_retention_policy
     WHERE category = p_category
       AND active
       AND policy_version = (SELECT max(policy_version) FROM vc.data_retention_policy
                              WHERE category = p_category AND active);
    IF v_days IS NULL THEN
        RAISE EXCEPTION 'active_retention_days: no active policy for %', p_category;
    END IF;
    RETURN v_days;
END;
$$;

-- ---------------------------------------------------------------------------
-- Per-category purges. Shared shape: cutoff required, idempotent, returns the
-- number of primary rows removed.
-- ---------------------------------------------------------------------------

CREATE FUNCTION vc.retention_purge_normal_chat(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_normal_chat: cutoff is required';
    END IF;
    -- Invalidate summaries covering soon-to-vanish messages FIRST (same
    -- transaction), mirroring the V63 delete_message rule set-based.
    UPDATE vc.conversation_summary s
       SET valid = false
     WHERE s.valid
       AND EXISTS (
           SELECT 1 FROM vc.message m
            WHERE m.created_at < p_cutoff
              AND m.owner_user_id = s.owner_user_id
              AND m.conversation_id = s.conversation_id
              AND m.id BETWEEN s.from_message_id AND s.to_message_id);
    DELETE FROM vc.message
     WHERE created_at < p_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE FUNCTION vc.retention_purge_deleted_chat(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_deleted_chat: cutoff is required';
    END IF;
    -- Deletes today are physical cascades: nothing left to purge. The policy
    -- row stays so the retention surface stays complete for a future
    -- soft-delete design.
    RETURN 0;
END;
$$;

CREATE FUNCTION vc.retention_purge_memory_candidate(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_memory_candidate: cutoff is required';
    END IF;
    DELETE FROM vc.memory_item
     WHERE status = 'PENDING_CONFIRMATION'
       AND created_at < p_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE FUNCTION vc.retention_purge_rejected_candidate(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_rejected_candidate: cutoff is required';
    END IF;
    DELETE FROM vc.memory_item
     WHERE status = 'REJECTED'
       AND created_at < p_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE FUNCTION vc.retention_purge_model_call_detail(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_routes int;
    v_attempts int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_model_call_detail: cutoff is required';
    END IF;
    DELETE FROM vc.generation_route
     WHERE created_at < p_cutoff;
    GET DIAGNOSTICS v_routes = ROW_COUNT;
    DELETE FROM vc.provider_attempt
     WHERE created_at < p_cutoff;
    GET DIAGNOSTICS v_attempts = ROW_COUNT;
    RETURN v_routes + v_attempts;
END;
$$;

CREATE FUNCTION vc.retention_purge_safety_log(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_safety_log: cutoff is required';
    END IF;
    DELETE FROM vc.safety_event
     WHERE created_at < p_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE FUNCTION vc.retention_purge_export_residue(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_export_residue: cutoff is required';
    END IF;
    -- Terminal rows only: a live PENDING/READY export is user-facing work,
    -- never swept by retention.
    DELETE FROM vc.export_request
     WHERE requested_at < p_cutoff
       AND status IN ('READY', 'FAILED', 'EXPIRED');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

CREATE FUNCTION vc.retention_purge_stream_fragment(p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_deleted int;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_purge_stream_fragment: cutoff is required';
    END IF;
    DELETE FROM vc.realtime_event
     WHERE created_at < p_cutoff;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the scheduler role (vc_api) may execute the policy read and the
-- purges; PUBLIC revoked defensively (V22 convention). No table-level DELETE
-- on any business table is granted to any runtime role.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION vc.active_retention_days(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.active_retention_days(text) TO vc_api;

REVOKE ALL ON FUNCTION vc.retention_purge_normal_chat(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_normal_chat(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_deleted_chat(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_deleted_chat(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_memory_candidate(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_memory_candidate(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_rejected_candidate(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_rejected_candidate(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_model_call_detail(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_model_call_detail(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_safety_log(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_safety_log(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_export_residue(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_export_residue(timestamptz) TO vc_api;
REVOKE ALL ON FUNCTION vc.retention_purge_stream_fragment(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.retention_purge_stream_fragment(timestamptz) TO vc_api;
