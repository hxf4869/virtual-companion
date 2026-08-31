-- S0-17-A/C: retention policy lifecycle, legal holds, dry-run estimates and
-- PITR deletion-tombstone reconciliation. Seeded V70 rows become explicit DRAFT;
-- runtime purge remains impossible until an approved version is marked ACTIVE.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.data_retention_policy
    ADD COLUMN status text NOT NULL DEFAULT 'DRAFT',
    ADD CONSTRAINT data_retention_policy_status CHECK (
        status IN ('DRAFT', 'ACTIVE', 'RETIRED'));

CREATE TABLE vc.retention_legal_hold (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_user_id bigint NOT NULL,
    category text NOT NULL,
    reason_code text NOT NULL,
    status text NOT NULL DEFAULT 'ACTIVE',
    created_by_account_id bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    released_by_account_id bigint,
    released_at timestamptz,
    CONSTRAINT retention_legal_hold_category CHECK (category IN (
        'ALL', 'NORMAL_CHAT', 'DELETED_CHAT', 'MEMORY_CANDIDATE',
        'REJECTED_CANDIDATE', 'MODEL_CALL_DETAIL', 'SAFETY_LOG',
        'EXPORT_RESIDUE', 'STREAM_FRAGMENT')),
    CONSTRAINT retention_legal_hold_reason CHECK (reason_code IN (
        'LEGAL', 'REGULATORY', 'DISPUTE', 'SAFETY_REVIEW')),
    CONSTRAINT retention_legal_hold_status CHECK (status IN ('ACTIVE', 'RELEASED')),
    CONSTRAINT retention_legal_hold_release_shape CHECK (
        (status = 'ACTIVE' AND released_by_account_id IS NULL AND released_at IS NULL)
        OR (status = 'RELEASED' AND released_by_account_id IS NOT NULL
            AND released_at IS NOT NULL))
);
CREATE UNIQUE INDEX retention_legal_hold_one_active
    ON vc.retention_legal_hold(owner_user_id, category) WHERE status = 'ACTIVE';
REVOKE ALL ON vc.retention_legal_hold FROM PUBLIC;

CREATE FUNCTION vc.retention_owner_held(p_owner_user_id bigint, p_category text)
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM vc.retention_legal_hold h
         WHERE h.owner_user_id = p_owner_user_id
           AND h.status = 'ACTIVE'
           AND h.category IN ('ALL', p_category))
$$;

CREATE FUNCTION vc.set_retention_legal_hold_current(
    p_owner_user_id bigint,
    p_category text,
    p_reason_code text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_actor bigint := vc.current_owner_id();
    v_role text;
    v_id bigint;
BEGIN
    SELECT a.role INTO v_role FROM vc.identity_account a
     WHERE a.id = v_actor AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'PRIVACY_OPERATOR') THEN
        RAISE EXCEPTION 'set_retention_legal_hold_current: mutation denied';
    END IF;
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0
       OR NOT EXISTS (SELECT 1 FROM vc.vc_user WHERE id = p_owner_user_id) THEN
        RAISE EXCEPTION 'set_retention_legal_hold_current: owner is required';
    END IF;
    IF p_category IS NULL OR p_category NOT IN (
        'ALL', 'NORMAL_CHAT', 'DELETED_CHAT', 'MEMORY_CANDIDATE',
        'REJECTED_CANDIDATE', 'MODEL_CALL_DETAIL', 'SAFETY_LOG',
        'EXPORT_RESIDUE', 'STREAM_FRAGMENT') THEN
        RAISE EXCEPTION 'set_retention_legal_hold_current: unsupported category';
    END IF;
    IF p_reason_code IS NULL OR p_reason_code NOT IN (
        'LEGAL', 'REGULATORY', 'DISPUTE', 'SAFETY_REVIEW') THEN
        RAISE EXCEPTION 'set_retention_legal_hold_current: unsupported reason';
    END IF;
    INSERT INTO vc.retention_legal_hold(
        owner_user_id, category, reason_code, created_by_account_id)
    VALUES (p_owner_user_id, p_category, p_reason_code, v_actor)
    ON CONFLICT (owner_user_id, category) WHERE status = 'ACTIVE'
    DO UPDATE SET reason_code = EXCLUDED.reason_code
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.release_retention_legal_hold_current(p_hold_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_actor bigint := vc.current_owner_id();
    v_role text;
BEGIN
    SELECT a.role INTO v_role FROM vc.identity_account a
     WHERE a.id = v_actor AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'PRIVACY_OPERATOR') THEN
        RAISE EXCEPTION 'release_retention_legal_hold_current: mutation denied';
    END IF;
    UPDATE vc.retention_legal_hold
       SET status = 'RELEASED', released_by_account_id = v_actor, released_at = now()
     WHERE id = p_hold_id AND status = 'ACTIVE';
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION vc.active_retention_days(p_category text)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_days integer;
BEGIN
    IF p_category IS NULL OR p_category = '' THEN
        RAISE EXCEPTION 'active_retention_days: category is required';
    END IF;
    SELECT retain_days INTO v_days FROM vc.data_retention_policy
     WHERE category = p_category AND active AND status = 'ACTIVE'
       AND policy_version = (
           SELECT max(policy_version) FROM vc.data_retention_policy
            WHERE category = p_category AND active AND status = 'ACTIVE');
    IF v_days IS NULL THEN
        RAISE EXCEPTION 'active_retention_days: no active policy for %', p_category;
    END IF;
    RETURN v_days;
END;
$$;

CREATE FUNCTION vc.retention_dry_run(p_category text, p_cutoff timestamptz)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_count integer;
BEGIN
    IF p_cutoff IS NULL THEN
        RAISE EXCEPTION 'retention_dry_run: cutoff is required';
    END IF;
    IF p_category = 'NORMAL_CHAT' THEN
        SELECT count(*) INTO v_count FROM vc.message x
         WHERE x.created_at < p_cutoff
           AND NOT vc.retention_owner_held(x.owner_user_id, p_category);
    ELSIF p_category = 'DELETED_CHAT' THEN
        v_count := 0;
    ELSIF p_category = 'MEMORY_CANDIDATE' THEN
        SELECT count(*) INTO v_count FROM vc.memory_item x
         WHERE x.status = 'PENDING_CONFIRMATION' AND x.created_at < p_cutoff
           AND NOT vc.retention_owner_held(x.owner_user_id, p_category);
    ELSIF p_category = 'REJECTED_CANDIDATE' THEN
        SELECT count(*) INTO v_count FROM vc.memory_item x
         WHERE x.status = 'REJECTED' AND x.created_at < p_cutoff
           AND NOT vc.retention_owner_held(x.owner_user_id, p_category);
    ELSIF p_category = 'MODEL_CALL_DETAIL' THEN
        SELECT (SELECT count(*) FROM vc.generation_route x
                 WHERE x.created_at < p_cutoff
                   AND NOT vc.retention_owner_held(x.owner_user_id, p_category))
             + (SELECT count(*) FROM vc.provider_attempt x
                 WHERE x.created_at < p_cutoff
                   AND NOT vc.retention_owner_held(x.owner_user_id, p_category))
          INTO v_count;
    ELSIF p_category = 'SAFETY_LOG' THEN
        SELECT count(*) INTO v_count FROM vc.safety_event x
         WHERE x.created_at < p_cutoff
           AND NOT vc.retention_owner_held(x.owner_user_id, p_category);
    ELSIF p_category = 'EXPORT_RESIDUE' THEN
        SELECT count(*) INTO v_count FROM vc.export_request x
         WHERE x.requested_at < p_cutoff
           AND x.status IN ('READY', 'FAILED', 'EXPIRED')
           AND NOT vc.retention_owner_held(x.owner_user_id, p_category);
    ELSIF p_category = 'STREAM_FRAGMENT' THEN
        SELECT count(*) INTO v_count FROM vc.realtime_event x
         WHERE x.created_at < p_cutoff
           AND NOT vc.retention_owner_held(x.owner_user_id, p_category);
    ELSE
        RAISE EXCEPTION 'retention_dry_run: unsupported category';
    END IF;
    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION vc.retention_purge_normal_chat(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_normal_chat: cutoff is required'; END IF;
    UPDATE vc.conversation_summary s SET valid = false
     WHERE s.valid AND NOT vc.retention_owner_held(s.owner_user_id, 'NORMAL_CHAT')
       AND EXISTS (SELECT 1 FROM vc.message m
                    WHERE m.created_at < p_cutoff
                      AND m.owner_user_id = s.owner_user_id
                      AND m.conversation_id = s.conversation_id
                      AND m.id BETWEEN s.from_message_id AND s.to_message_id);
    DELETE FROM vc.message x WHERE x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'NORMAL_CHAT');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

CREATE OR REPLACE FUNCTION vc.retention_purge_memory_candidate(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_memory_candidate: cutoff is required'; END IF;
    DELETE FROM vc.memory_item x WHERE x.status = 'PENDING_CONFIRMATION'
      AND x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'MEMORY_CANDIDATE');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

CREATE OR REPLACE FUNCTION vc.retention_purge_rejected_candidate(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_rejected_candidate: cutoff is required'; END IF;
    DELETE FROM vc.memory_item x WHERE x.status = 'REJECTED' AND x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'REJECTED_CANDIDATE');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

CREATE OR REPLACE FUNCTION vc.retention_purge_model_call_detail(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_routes integer; v_attempts integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_model_call_detail: cutoff is required'; END IF;
    DELETE FROM vc.generation_route x WHERE x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'MODEL_CALL_DETAIL');
    GET DIAGNOSTICS v_routes = ROW_COUNT;
    DELETE FROM vc.provider_attempt x WHERE x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'MODEL_CALL_DETAIL');
    GET DIAGNOSTICS v_attempts = ROW_COUNT;
    RETURN v_routes + v_attempts;
END $$;

CREATE OR REPLACE FUNCTION vc.retention_purge_safety_log(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_safety_log: cutoff is required'; END IF;
    DELETE FROM vc.safety_event x WHERE x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'SAFETY_LOG');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

CREATE OR REPLACE FUNCTION vc.retention_purge_export_residue(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_export_residue: cutoff is required'; END IF;
    DELETE FROM vc.export_request x WHERE x.requested_at < p_cutoff
      AND x.status IN ('READY', 'FAILED', 'EXPIRED')
      AND NOT vc.retention_owner_held(x.owner_user_id, 'EXPORT_RESIDUE');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

CREATE OR REPLACE FUNCTION vc.retention_purge_stream_fragment(p_cutoff timestamptz)
    RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = vc, pg_catalog AS $$
DECLARE v_deleted integer;
BEGIN
    IF p_cutoff IS NULL THEN RAISE EXCEPTION 'retention_purge_stream_fragment: cutoff is required'; END IF;
    DELETE FROM vc.realtime_event x WHERE x.created_at < p_cutoff
      AND NOT vc.retention_owner_held(x.owner_user_id, 'STREAM_FRAGMENT');
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END $$;

-- Manifest functions are migration-owner only. Export rows to storage outside
-- the PITR boundary; reconcile a restored database in dry-run mode first.
CREATE FUNCTION vc.export_account_deletion_tombstones()
    RETURNS TABLE(
        out_account_id bigint,
        out_username_digest text,
        out_status text,
        out_requested_at timestamptz,
        out_completed_at timestamptz)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT d.account_id, d.username_digest, d.status, d.requested_at, d.completed_at
      FROM vc.account_deletion_intent d ORDER BY d.account_id
$$;

CREATE FUNCTION vc.reconcile_account_deletion_tombstone(
    p_account_id bigint,
    p_username_digest text,
    p_requested_at timestamptz,
    p_completed_at timestamptz,
    p_apply boolean DEFAULT false
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_match record;
    v_matches integer := 0;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0
       OR p_username_digest IS NULL OR p_username_digest !~ '^[0-9a-f]{64}$'
       OR p_requested_at IS NULL OR p_completed_at IS NULL THEN
        RAISE EXCEPTION 'reconcile_account_deletion_tombstone: invalid manifest row';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.username_digest = p_username_digest
                  AND d.account_id <> p_account_id) THEN
        RAISE EXCEPTION 'reconcile_account_deletion_tombstone: digest conflict';
    END IF;
    FOR v_match IN
        SELECT a.id, a.username FROM vc.identity_account a
         WHERE vc.username_tombstone_digest(a.username) = p_username_digest
    LOOP
        v_matches := v_matches + 1;
        IF COALESCE(p_apply, false) THEN
            INSERT INTO vc.identity_auth_event(event_type, account_id, username)
            VALUES ('ACCOUNT_DELETE_REQUESTED', v_match.id, v_match.username),
                   ('ACCOUNT_DELETE', v_match.id, v_match.username);
            DELETE FROM vc.vc_user WHERE id = v_match.id;
        END IF;
    END LOOP;
    IF COALESCE(p_apply, false) THEN
        INSERT INTO vc.account_deletion_intent(
            account_id, username_digest, status, requested_at, completed_at, poll_until)
        VALUES (p_account_id, p_username_digest, 'COMPLETED',
                p_requested_at, p_completed_at, now())
        ON CONFLICT (account_id) DO UPDATE
           SET username_digest = EXCLUDED.username_digest,
               status = 'COMPLETED', requested_at = EXCLUDED.requested_at,
               completed_at = EXCLUDED.completed_at,
               poll_until = now();
    END IF;
    RETURN v_matches;
END;
$$;

CREATE FUNCTION vc.run_retention_category(p_category text, p_dry_run boolean)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_days integer;
    v_cutoff timestamptz;
BEGIN
    IF p_category IS NULL OR p_category NOT IN (
        'NORMAL_CHAT', 'DELETED_CHAT', 'MEMORY_CANDIDATE',
        'REJECTED_CANDIDATE', 'MODEL_CALL_DETAIL', 'SAFETY_LOG',
        'EXPORT_RESIDUE', 'STREAM_FRAGMENT') THEN
        RAISE EXCEPTION 'run_retention_category: unsupported category';
    END IF;
    v_days := vc.active_retention_days(p_category);
    v_cutoff := now() - make_interval(days => v_days);
    IF COALESCE(p_dry_run, true) THEN
        RETURN vc.retention_dry_run(p_category, v_cutoff);
    END IF;
    RETURN CASE p_category
        WHEN 'NORMAL_CHAT' THEN vc.retention_purge_normal_chat(v_cutoff)
        WHEN 'DELETED_CHAT' THEN vc.retention_purge_deleted_chat(v_cutoff)
        WHEN 'MEMORY_CANDIDATE' THEN vc.retention_purge_memory_candidate(v_cutoff)
        WHEN 'REJECTED_CANDIDATE' THEN vc.retention_purge_rejected_candidate(v_cutoff)
        WHEN 'MODEL_CALL_DETAIL' THEN vc.retention_purge_model_call_detail(v_cutoff)
        WHEN 'SAFETY_LOG' THEN vc.retention_purge_safety_log(v_cutoff)
        WHEN 'EXPORT_RESIDUE' THEN vc.retention_purge_export_residue(v_cutoff)
        WHEN 'STREAM_FRAGMENT' THEN vc.retention_purge_stream_fragment(v_cutoff)
        ELSE 0
    END;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.retention_purge_normal_chat(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_deleted_chat(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_memory_candidate(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_rejected_candidate(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_model_call_detail(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_safety_log(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_export_residue(timestamptz) FROM vc_api;
REVOKE EXECUTE ON FUNCTION vc.retention_purge_stream_fragment(timestamptz) FROM vc_api;

REVOKE ALL ON FUNCTION vc.run_retention_category(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.run_retention_category(text, boolean) TO vc_api;

REVOKE ALL ON FUNCTION vc.retention_owner_held(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.set_retention_legal_hold_current(bigint, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.release_retention_legal_hold_current(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.retention_dry_run(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_account_deletion_tombstones() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.reconcile_account_deletion_tombstone(
    bigint, text, timestamptz, timestamptz, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.set_retention_legal_hold_current(bigint, text, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.release_retention_legal_hold_current(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.retention_dry_run(text, timestamptz) TO vc_api;
