-- A scope revision that moves during propose or a forget-profile rebuild must
-- be adopted by the same claimed job. The extract operation id changes only
-- while nothing has been published; a forget profile id keeps its prefix.
SET search_path = vc, pg_catalog;

CREATE FUNCTION vc.go_memorycore_rebind(
    p_owner bigint, p_job bigint, p_token text, p_fence text,
    p_operation text, p_profile text, p_revision bigint)
RETURNS TABLE(out_operation text, out_profile text, out_revision bigint, out_state text, out_relationship bigint, out_conversation bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE
    op vc.memorycore_operation%ROWTYPE;
    conv bigint;
    adopted bigint;
    next_operation text;
    next_profile text;
    next_state text;
    forget boolean;
    keep boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.memory_write_barrier(p_owner);
    IF NOT EXISTS (
        SELECT 1 FROM vc.work_item
        WHERE owner_user_id = p_owner AND id = p_job AND status = 'CLAIMED'
          AND claim_token = p_token AND claim_fence = p_fence AND lease_expires_at > clock_timestamp()) THEN
        RAISE EXCEPTION 'memorycore claim lost';
    END IF;
    SELECT * INTO op FROM vc.memorycore_operation WHERE owner_user_id = p_owner AND job_id = p_job FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'memorycore operation missing'; END IF;
    SELECT conversation_id INTO conv FROM vc.st_message_source WHERE owner_user_id = p_owner AND id = op.source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'memorycore source missing'; END IF;
    SELECT revision INTO adopted FROM vc.memorycore_scope
     WHERE owner_user_id = p_owner AND relationship_id = op.relationship_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'memorycore scope missing'; END IF;
    IF COALESCE(p_operation, '') <> '' AND p_operation !~ '^[A-Za-z0-9_-]{1,120}$' THEN
        RAISE EXCEPTION 'memorycore operation invalid';
    END IF;
    IF COALESCE(p_profile, '') <> '' AND p_profile !~ '^[A-Za-z0-9_-]{1,120}$' THEN
        RAISE EXCEPTION 'memorycore operation invalid';
    END IF;
    IF COALESCE(p_revision, 0) > adopted THEN
        adopted := p_revision;
        UPDATE vc.memorycore_scope SET revision = adopted
         WHERE owner_user_id = p_owner AND relationship_id = op.relationship_id;
    END IF;
    forget := COALESCE(op.profile_operation_id, '') ~ '^forget-[1-9][0-9]*-profile(-a[1-9][0-9]*)?$'
        OR COALESCE(p_profile, '') ~ '^forget-[1-9][0-9]*-profile(-a[1-9][0-9]*)?$';
    keep := op.state = 'PUBLISHED' OR forget OR EXISTS (
        SELECT 1 FROM vc.memory_item mi
        WHERE mi.owner_user_id = p_owner AND mi.engine_operation_id = op.operation_id);
    IF keep THEN
        next_operation := op.operation_id;
        next_state := CASE WHEN forget THEN 'PUBLISHED' ELSE op.state END;
        next_profile := CASE WHEN COALESCE(p_profile, '') <> '' THEN p_profile ELSE op.profile_operation_id END;
        UPDATE vc.memorycore_operation
           SET revision = adopted, state = next_state, profile_operation_id = next_profile
         WHERE owner_user_id = p_owner AND job_id = p_job;
    ELSE
        IF COALESCE(p_operation, '') = '' OR EXISTS (
            SELECT 1 FROM vc.memorycore_operation other
            WHERE other.owner_user_id = p_owner AND other.operation_id = p_operation AND other.job_id <> p_job) THEN
            RAISE EXCEPTION 'memorycore operation invalid';
        END IF;
        next_operation := p_operation;
        next_state := 'NEW';
        next_profile := NULLIF(p_profile, '');
        UPDATE vc.memorycore_operation
           SET operation_id = next_operation, revision = adopted, state = 'NEW', proposal = NULL,
               profile_operation_id = next_profile
         WHERE owner_user_id = p_owner AND job_id = p_job;
    END IF;
    out_operation := next_operation;
    out_profile := COALESCE(next_profile, '');
    out_revision := adopted;
    out_state := next_state;
    out_relationship := op.relationship_id;
    out_conversation := conv;
    RETURN NEXT;
END;
$$;

CREATE FUNCTION vc.memory_forget_profile_gate(p_owner bigint, p_id bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE st text; attempts integer;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_id IS NULL OR p_id <= 0 THEN RETURN 'NONE'; END IF;
    SELECT w.status, w.attempt_count INTO st, attempts
      FROM vc.memorycore_operation op
      JOIN vc.work_item w ON (w.owner_user_id, w.id) = (op.owner_user_id, op.job_id)
     WHERE op.owner_user_id = p_owner
       AND op.profile_operation_id ~ ('^forget-' || p_id::text || '-profile(-a[1-9][0-9]*)?$')
     ORDER BY w.id DESC
     LIMIT 1;
    IF NOT FOUND THEN RETURN 'NONE'; END IF;
    IF st = 'DONE' THEN RETURN 'DONE'; END IF;
    IF st = 'DEAD_LETTERED' OR (st = 'FAILED' AND attempts >= 3) THEN RETURN 'DEAD'; END IF;
    RETURN 'PENDING';
END;
$$;

-- A rotated forget profile id (forget-{id}-profile-aN) still blocks DONE.
CREATE OR REPLACE FUNCTION vc.memory_cleanup_finish(p_owner bigint, p_id bigint, p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_state NOT IN ('DONE', 'PARTIAL') THEN RAISE EXCEPTION 'invalid cleanup state'; END IF;
    SELECT * INTO m FROM vc.memory_item WHERE owner_user_id = p_owner AND id = p_id AND deleted_at IS NOT NULL;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM vc.memory_erase_forgotten_wording(p_owner, p_id);
    IF p_state = 'DONE' AND (
        EXISTS (
            SELECT 1 FROM vc.conversation_summary cs
            JOIN vc.conversation c ON (c.owner_user_id, c.id) = (cs.owner_user_id, cs.conversation_id)
            WHERE cs.owner_user_id = p_owner AND c.relationship_id = m.relationship_id
              AND cs.valid AND btrim(cs.summary) <> '' AND cs.created_at <= m.deleted_at
              AND EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id = p_owner AND e.memory_item_id = p_id AND e.source_ref = ANY(cs.st_source_refs)))
        OR EXISTS (
            SELECT 1 FROM vc.memorycore_operation op
            JOIN vc.work_item w ON (w.owner_user_id, w.id) = (op.owner_user_id, op.job_id)
            WHERE op.owner_user_id = p_owner AND op.relationship_id = m.relationship_id
              AND op.profile_operation_id ~ ('^forget-' || p_id::text || '-profile(-a[1-9][0-9]*)?$')
              AND w.status IS DISTINCT FROM 'DONE')
    ) THEN
        p_state := 'PARTIAL';
    END IF;
    UPDATE vc.memory_item SET cleanup_state = p_state,
        cleanup_detail = CASE WHEN p_state = 'DONE' THEN '在线记忆副本已清理；原始聊天及离线备份不属于本次遗忘范围。' ELSE '部分在线副本仍在清理，记忆已停止召回。' END
     WHERE owner_user_id = p_owner AND id = p_id AND deleted_at IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_memorycore_rebind(bigint, bigint, text, text, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_memorycore_rebind(bigint, bigint, text, text, text, text, bigint) TO vc_api, vc_worker;
REVOKE ALL ON FUNCTION vc.memory_forget_profile_gate(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_forget_profile_gate(bigint, bigint) TO vc_api, vc_worker;
