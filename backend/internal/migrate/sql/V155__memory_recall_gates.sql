-- G13: forgetting clears matching profile text so it cannot be injected;
-- profile rebuild retries stay bounded; an ambiguous source with an empty
-- engine proposal still becomes one needs_clarification memory.
SET search_path = vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.memory_erase_forgotten_wording(p_owner bigint, p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; wording text; correction text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT * INTO m FROM vc.memory_item WHERE owner_user_id = p_owner AND id = p_id FOR UPDATE;
    IF NOT FOUND OR m.deleted_at IS NULL THEN RETURN; END IF;
    wording := btrim(m.summary);
    correction := btrim(COALESCE(m.correction_summary, ''));
    UPDATE vc.memory_profile mp SET valid = false, persona = '', scenes = '[]'::jsonb
     WHERE mp.owner_user_id = p_owner AND mp.relationship_id = m.relationship_id
       AND (
            (m.engine_record_id IS NOT NULL AND m.engine_record_id = ANY(mp.record_ids))
            OR CASE WHEN wording <> '' THEN position(wording in mp.persona) > 0 OR position(wording in mp.scenes::text) > 0 ELSE false END
            OR CASE WHEN correction <> '' THEN position(correction in mp.persona) > 0 OR position(correction in mp.scenes::text) > 0 ELSE false END);
    UPDATE vc.conversation_summary cs SET valid = false, summary = ''
     WHERE cs.owner_user_id = p_owner
       AND cs.conversation_id IN (SELECT id FROM vc.conversation WHERE owner_user_id = p_owner AND relationship_id = m.relationship_id)
       AND (
            EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id = p_owner AND e.memory_item_id = p_id AND e.source_ref = ANY(cs.st_source_refs))
            OR CASE WHEN wording <> '' THEN position(wording in cs.summary) > 0 ELSE false END
            OR CASE WHEN correction <> '' THEN position(correction in cs.summary) > 0 ELSE false END);
    UPDATE vc.memory_item SET summary = '', correction_summary = NULL
     WHERE owner_user_id = p_owner AND id = p_id AND deleted_at IS NOT NULL;
END;
$$;

-- Source suppression during delete bumps memorycore_scope.revision. A profile
-- rebuild must adopt that revision, or go_record_memorycore_profile rejects
-- the claim and the replacement profile can never land.
CREATE OR REPLACE FUNCTION vc.memory_forget_begin(p_owner bigint, p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint; rebuild_job bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.memory_write_barrier(p_owner);
    SELECT * INTO m FROM vc.memory_item WHERE owner_user_id = p_owner AND id = p_id FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF m.cleanup_state <> 'NONE' THEN
        PERFORM vc.memory_erase_forgotten_wording(p_owner, p_id);
        RETURN true;
    END IF;
    SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id = p_owner AND relationship_id = m.relationship_id FOR UPDATE;
    PERFORM vc.delete_memory(p_owner, p_id);
    PERFORM vc.memory_erase_forgotten_wording(p_owner, p_id);
    SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id = p_owner AND relationship_id = m.relationship_id;
    SELECT op.job_id INTO rebuild_job
      FROM vc.memorycore_operation op
      JOIN vc.st_message_source src ON (src.owner_user_id, src.id) = (op.owner_user_id, op.source_id)
     WHERE op.owner_user_id = p_owner AND op.relationship_id = m.relationship_id AND op.state = 'PUBLISHED'
       AND src.present AND src.settled AND src.eligible AND NOT src.suppressed
       AND EXISTS (
            SELECT 1 FROM vc.memory_item mi
            JOIN vc.memory_evidence e ON (e.owner_user_id, e.memory_item_id) = (mi.owner_user_id, mi.id)
            WHERE mi.owner_user_id = p_owner AND mi.relationship_id = m.relationship_id AND mi.id <> p_id
              AND mi.deleted_at IS NULL AND mi.superseded_at IS NULL AND mi.source_invalidated_at IS NULL
              AND mi.status = 'ACCEPTED' AND mi.engine_record_id IS NOT NULL AND e.source_ref = src.source_ref)
     ORDER BY op.job_id DESC LIMIT 1;
    IF rebuild_job IS NOT NULL THEN
        UPDATE vc.memorycore_operation SET profile_operation_id = 'forget-' || p_id::text || '-profile', revision = COALESCE(rev, revision)
         WHERE owner_user_id = p_owner AND job_id = rebuild_job;
        UPDATE vc.work_item SET status = 'PENDING', attempt_count = 0, next_attempt_at = NULL, claim_token = NULL, claim_fence = NULL, claimed_at = NULL, lease_expires_at = NULL, finished_at = NULL
         WHERE owner_user_id = p_owner AND id = rebuild_job;
    END IF;
    UPDATE vc.memory_item SET cleanup_state = 'PENDING', cleanup_revision = COALESCE(rev, 0) WHERE owner_user_id = p_owner AND id = p_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION vc.go_enqueue_memory_profile_rebuild(p_owner bigint, p_rel bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE rebuild_job bigint; rebuild_status text; rebuild_attempts integer;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT op.job_id, w.status, w.attempt_count INTO rebuild_job, rebuild_status, rebuild_attempts
      FROM vc.memorycore_operation op
      JOIN vc.st_message_source src ON (src.owner_user_id, src.id) = (op.owner_user_id, op.source_id)
      JOIN vc.work_item w ON (w.owner_user_id, w.id) = (op.owner_user_id, op.job_id)
     WHERE op.owner_user_id = p_owner AND op.relationship_id = p_rel AND op.state = 'PUBLISHED'
       AND src.present AND src.settled AND src.eligible AND NOT src.suppressed
       AND w.status IN ('DONE', 'FAILED', 'DEAD_LETTERED')
       AND EXISTS (
            SELECT 1 FROM vc.memory_item mi
            JOIN vc.memory_evidence e ON (e.owner_user_id, e.memory_item_id) = (mi.owner_user_id, mi.id)
            WHERE mi.owner_user_id = p_owner AND mi.relationship_id = p_rel
              AND mi.deleted_at IS NULL AND mi.superseded_at IS NULL AND mi.source_invalidated_at IS NULL
              AND mi.status = 'ACCEPTED' AND mi.engine_record_id IS NOT NULL AND e.source_ref = src.source_ref)
     ORDER BY op.job_id DESC LIMIT 1;
    IF rebuild_job IS NULL THEN RETURN; END IF;
    -- 3 matches memoryExtractMaxAttempts. A dead letter is not cleared by the next question.
    IF rebuild_status = 'DEAD_LETTERED' OR (rebuild_status = 'FAILED' AND rebuild_attempts >= 3) THEN
        RETURN;
    END IF;
    UPDATE vc.work_item SET status = 'PENDING',
        attempt_count = CASE WHEN rebuild_status = 'DONE' THEN 0 ELSE attempt_count END,
        next_attempt_at = NULL, claim_token = NULL, claim_fence = NULL, claimed_at = NULL,
        lease_expires_at = NULL, finished_at = NULL
     WHERE owner_user_id = p_owner AND id = rebuild_job AND status = rebuild_status;
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE vc.memorycore_operation SET profile_operation_id = 'recall-' || p_rel::text || '-profile'
     WHERE owner_user_id = p_owner AND job_id = rebuild_job;
END;
$$;

CREATE FUNCTION vc.go_memorycore_clarification(p_owner bigint, p_job bigint, p_token text, p_fence text, p_summary text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE op vc.memorycore_operation; ref text; conv bigint; mid bigint; summary text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.memory_write_barrier(p_owner);
    SELECT * INTO op FROM vc.memorycore_operation WHERE owner_user_id = p_owner AND job_id = p_job FOR UPDATE;
    IF NOT FOUND OR op.state IS DISTINCT FROM 'PUBLISHED' THEN RAISE EXCEPTION 'memorycore operation invalid'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.work_item WHERE owner_user_id = p_owner AND id = p_job AND kind = 'ST_MEMORY_EXTRACT'
        AND status = 'CLAIMED' AND claim_token = p_token AND claim_fence = p_fence AND lease_expires_at > clock_timestamp()) THEN
        RAISE EXCEPTION 'memorycore claim lost';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.memory_item WHERE owner_user_id = p_owner AND engine_operation_id = op.operation_id) THEN
        RETURN 0;
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' THEN RETURN 0; END IF;
    summary := left(btrim(p_summary), 2000);
    SELECT src.conversation_id, src.source_ref INTO conv, ref
      FROM vc.st_message_source src
     WHERE src.owner_user_id = p_owner AND src.id = op.source_id;
    IF NOT FOUND OR ref IS NULL OR NOT vc.guard_st_memory_source(p_owner, op.relationship_id, ref) THEN
        RAISE EXCEPTION 'memorycore source invalid';
    END IF;
    mid := nextval('vc.memory_id_seq');
    INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status, conversation_id, auto_saved, engine_operation_id)
    VALUES (p_owner, mid, op.relationship_id, 'RELATIONSHIP', summary, 'ACCEPTED', conv, true, op.operation_id);
    INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref)
    VALUES (p_owner, nextval('vc.memory_id_seq'), mid, ref);
    RETURN mid;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_memorycore_clarification(bigint, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_memorycore_clarification(bigint, bigint, text, text, text) TO vc_api, vc_worker;
