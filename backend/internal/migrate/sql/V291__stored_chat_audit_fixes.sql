-- SX-7F: cascade lock order, bounded change retention and final profile authority.
SET search_path=vc,pg_catalog;

CREATE OR REPLACE FUNCTION vc.delete_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'delete_conversation: conversation id is required';
    END IF;
    -- V17 trusted-owner assertion: caller identity is server-trusted only.
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_conversation: owner_user_id must match server-trusted context';
    END IF;
    -- Same prefix as chat writers, before locking any cascade parent/child.
    PERFORM 1 FROM vc.vc_user WHERE id=p_owner_user_id FOR NO KEY UPDATE;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    -- Both work item kinds reference the generation id; a deleted conversation
    -- must never leave a worker processing a dangling ref (it would retry into
    -- dead-letter). In-flight items are cancelled before the rows cascade.
    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (SELECT g.id
                          FROM vc.generation g
                         WHERE g.owner_user_id = p_owner_user_id
                           AND g.conversation_id = p_conversation_id);
    DELETE FROM vc.conversation
     WHERE owner_user_id = p_owner_user_id
       AND id = p_conversation_id;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION vc.reset_relationship(
    p_owner_user_id     bigint,
    p_relationship_id   bigint,
    p_retain_importable boolean DEFAULT false
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'reset_relationship: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'reset_relationship: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'reset_relationship: owner_user_id must match server-trusted context';
    END IF;
    -- Same prefix as chat writers, before locking any cascade parent/child.
    PERFORM 1 FROM vc.vc_user WHERE id=p_owner_user_id FOR NO KEY UPDATE;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);


    PERFORM 1
       FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id
        AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF p_retain_importable THEN
        PERFORM vc.snapshot_importable_memories(p_owner_user_id, p_relationship_id);
    END IF;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
               AND c.relationship_id = p_relationship_id
       );

    DELETE FROM vc.conversation
     WHERE owner_user_id = p_owner_user_id
       AND relationship_id = p_relationship_id;
    DELETE FROM vc.memory_item
     WHERE owner_user_id = p_owner_user_id
       AND relationship_id = p_relationship_id;
    DELETE FROM vc.reminder
     WHERE owner_user_id = p_owner_user_id
       AND relationship_id = p_relationship_id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.delete_relationship(
    p_owner_user_id     bigint,
    p_relationship_id   bigint,
    p_retain_importable boolean DEFAULT false
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_relationship: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'delete_relationship: relationship id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_relationship: owner_user_id must match server-trusted context';
    END IF;
    -- Same prefix as chat writers, before locking any cascade parent/child.
    PERFORM 1 FROM vc.vc_user WHERE id=p_owner_user_id FOR NO KEY UPDATE;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);


    PERFORM 1
       FROM vc.relationship r
      WHERE r.owner_user_id = p_owner_user_id
        AND r.id = p_relationship_id;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF p_retain_importable THEN
        PERFORM vc.snapshot_importable_memories(p_owner_user_id, p_relationship_id);
    END IF;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind IN ('GENERATION', 'MEMORY_EXTRACT')
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
              JOIN vc.conversation c
                ON c.owner_user_id = g.owner_user_id
               AND c.id = g.conversation_id
             WHERE g.owner_user_id = p_owner_user_id
               AND c.relationship_id = p_relationship_id
       );

    DELETE FROM vc.relationship
     WHERE owner_user_id = p_owner_user_id
       AND id = p_relationship_id;
    RETURN FOUND;
END;
$$;

-- Cursor-pull changes have no dispatched_at producer. Delivery never gates retention.
COMMENT ON COLUMN vc.chat_change.dispatched_at IS 'Unused by current cursor-pull delivery; never a retention gate';
DROP INDEX vc.chat_change_retention;
CREATE INDEX chat_change_retention ON vc.chat_change(owner_user_id,created_at,chat_id,revision);

CREATE OR REPLACE FUNCTION vc.insert_chat_receipt(p_owner bigint,p_resource text,p_request uuid,p_digest bytea,p_operation uuid,p_chat uuid,p_revision bigint,p_status integer,p_result text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.require_stored_chat_writer(p_owner);
    INSERT INTO vc.chat_receipt(owner_user_id,resource,request_id,request_digest,operation_id,chat_id,result_revision,status,result_cipher)
    VALUES(p_owner,p_resource,p_request,p_digest,p_operation,p_chat,p_revision,p_status,p_result);
    UPDATE vc.chat_receipt SET result_cipher=NULL WHERE owner_user_id=p_owner AND expires_at<=now() AND result_cipher IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION vc.prune_stored_chat_runs() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE owner_id bigint;
BEGIN
 FOR owner_id IN SELECT u.id FROM vc.vc_user u WHERE EXISTS(
   SELECT 1 FROM vc.chat_generation_run r WHERE r.owner_user_id=u.id
    AND ((r.state='active' AND r.expires_at<=clock_timestamp()) OR (r.fence IS NOT NULL AND r.registered_at<clock_timestamp()-interval '7 days')))
   OR EXISTS(SELECT 1 FROM vc.chat_receipt r WHERE r.owner_user_id=u.id AND r.result_cipher IS NOT NULL AND r.expires_at<=clock_timestamp())
   OR EXISTS(SELECT 1 FROM vc.chat_change c WHERE c.owner_user_id=u.id AND c.created_at<now()-interval '7 days')
   ORDER BY u.id LIMIT 32 FOR NO KEY UPDATE OF u SKIP LOCKED
 LOOP
  UPDATE vc.chat_generation_run SET state='expired' WHERE owner_user_id=owner_id AND state='active' AND expires_at<=clock_timestamp();
  UPDATE vc.chat_generation_run SET fence=NULL WHERE owner_user_id=owner_id AND fence IS NOT NULL AND registered_at<clock_timestamp()-interval '7 days';
  UPDATE vc.chat_receipt SET result_cipher=NULL WHERE owner_user_id=owner_id AND result_cipher IS NOT NULL AND expires_at<=clock_timestamp();
  -- At most 500 changes per owner and 32 owners per scheduler tick (16000
  -- rows maximum), including accounts that never write another chat.
  WITH expired AS (
   SELECT chat_id,revision FROM vc.chat_change
   WHERE owner_user_id=owner_id AND created_at<now()-interval '7 days'
   ORDER BY created_at,chat_id,revision LIMIT 500
  ) DELETE FROM vc.chat_change c USING expired e
    WHERE c.owner_user_id=owner_id AND c.chat_id=e.chat_id AND c.revision=e.revision;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION vc.go_record_memorycore_profile(
    p_owner bigint, p_job bigint, p_token text, p_fence text, p_refs text[],
    p_persona text, p_scenes jsonb, p_record_ids text[], p_fingerprint text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE op vc.memorycore_operation; conv bigint; ref text; fp text; full_refs text[]; full_ids text[]; profile_id bigint; scene jsonb;
BEGIN
    PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
    SELECT * INTO op FROM vc.memorycore_operation WHERE owner_user_id = p_owner AND job_id = p_job AND state = 'PUBLISHED';
    IF NOT FOUND THEN RAISE EXCEPTION 'profile operation missing'; END IF;
    PERFORM 1 FROM vc.memorycore_scope WHERE owner_user_id = p_owner AND relationship_id = op.relationship_id AND revision = op.revision FOR UPDATE;
    IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM vc.work_item WHERE owner_user_id = p_owner AND id = p_job AND status = 'CLAIMED' AND claim_token = p_token AND claim_fence = p_fence AND lease_expires_at > clock_timestamp()) THEN
        RAISE EXCEPTION 'profile claim lost';
    END IF;
    FOREACH ref IN ARRAY COALESCE(p_refs, '{}') LOOP
        IF NOT vc.guard_st_evidence_write(p_owner, op.relationship_id, ref) THEN RAISE EXCEPTION 'profile source invalid'; END IF;
    END LOOP;
    IF p_persona IS NULL OR btrim(p_persona) = '' OR length(p_persona) > 16000 THEN RAISE EXCEPTION 'profile invalid'; END IF;
    IF p_scenes IS NULL THEN p_scenes := '[]'::jsonb; END IF;
    IF jsonb_typeof(p_scenes) <> 'array' THEN RAISE EXCEPTION 'profile scenes invalid'; END IF;
    FOR scene IN SELECT value FROM jsonb_array_elements(p_scenes) LOOP
        IF jsonb_typeof(scene) <> 'object' OR COALESCE(scene->>'file', '') NOT LIKE 'scene_blocks/%.md' OR position('..' in scene->>'file') > 0
           OR jsonb_typeof(COALESCE(scene->'recordIds', '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'profile scenes invalid'; END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(scene->'recordIds') rid WHERE NOT rid = ANY(COALESCE(p_record_ids, '{}'))) THEN
            RAISE EXCEPTION 'profile scene record changed';
        END IF;
    END LOOP;
    SELECT conversation_id INTO conv FROM vc.st_message_source WHERE owner_user_id = p_owner AND id = op.source_id;
    PERFORM 1 FROM vc.conversation WHERE owner_user_id = p_owner AND id = conv AND relationship_id = op.relationship_id AND st_mode = 'COMPANION' AND st_source_state = 'PRESENT' AND NOT incognito FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'memorycore target binding changed'; END IF;
    IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_refs, '{}')) AS dep(source_ref) WHERE NOT EXISTS (
        SELECT 1 FROM vc.st_message_source src
        JOIN vc.conversation origin ON (origin.owner_user_id, origin.id) = (src.owner_user_id, src.conversation_id)
        JOIN vc.conversation target ON target.owner_user_id = p_owner AND target.id = conv
        JOIN vc.relationship rel ON (rel.owner_user_id, rel.id) = (target.owner_user_id, target.relationship_id)
        WHERE src.owner_user_id = p_owner AND src.source_ref = dep.source_ref AND origin.relationship_id = target.relationship_id
          AND origin.st_mode = 'COMPANION' AND origin.st_source_state = 'PRESENT' AND NOT origin.incognito
          AND (origin.id = target.id OR (rel.memory_share_scope <> 'SESSION'
              AND COALESCE(origin.st_branch_root, origin.st_chat_identity) <> COALESCE(target.st_branch_root, target.st_chat_identity)))))
    THEN RAISE EXCEPTION 'memorycore dependency scope changed'; END IF;
    IF EXISTS (SELECT 1 FROM vc.memorycore_operation newer
        JOIN vc.st_message_source src ON (src.owner_user_id, src.id) = (newer.owner_user_id, newer.source_id)
        WHERE newer.owner_user_id = p_owner AND newer.job_id > p_job AND newer.state = 'PUBLISHED' AND src.conversation_id = conv
          AND (jsonb_array_length(COALESCE(newer.proposal->'records', '[]')) > 0 OR jsonb_array_length(COALESCE(newer.proposal->'targets', '[]')) > 0))
    THEN RETURN 0; END IF;
    fp := vc.memory_profile_fingerprint(p_owner, op.relationship_id, conv);
    IF p_fingerprint IS DISTINCT FROM fp OR fp = '' THEN RAISE EXCEPTION 'profile fingerprint changed'; END IF;
    SELECT COALESCE(array_agg(DISTINCT a.record_id ORDER BY a.record_id), '{}') INTO full_ids FROM vc.memory_profile_allowlist(p_owner, op.relationship_id, conv) a;
    SELECT COALESCE(array_agg(DISTINCT a.source_ref ORDER BY a.source_ref), '{}') INTO full_refs FROM vc.memory_profile_allowlist(p_owner, op.relationship_id, conv) a;
    IF full_ids IS DISTINCT FROM (SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}') FROM unnest(COALESCE(p_record_ids, '{}')) AS listed(x)) THEN
        RAISE EXCEPTION 'profile record set changed';
    END IF;
    IF cardinality(COALESCE(p_refs, '{}')) = 0 OR EXISTS (SELECT 1 FROM unnest(p_refs) AS listed(source_ref) WHERE NOT listed.source_ref = ANY(full_refs)) THEN
        RAISE EXCEPTION 'profile source invalid';
    END IF;
    -- Persisted refs include the full allowlist, not only the engine's subset.
    -- Pin remaining dependencies under the existing memory barrier too.
    FOREACH ref IN ARRAY full_refs LOOP
        IF NOT ref = ANY(p_refs) AND NOT vc.guard_st_evidence_write(p_owner, op.relationship_id, ref) THEN
            RAISE EXCEPTION 'profile source invalid';
        END IF;
    END LOOP;
    UPDATE vc.memory_profile mp SET valid = false, persona = '', scenes = '[]'::jsonb
     WHERE mp.owner_user_id = p_owner AND mp.relationship_id = op.relationship_id AND mp.fingerprint IS DISTINCT FROM p_fingerprint
       AND EXISTS (
            SELECT 1 FROM unnest(mp.record_ids) AS rid(record_id)
            JOIN vc.memory_item mi ON mi.owner_user_id = p_owner AND mi.relationship_id = op.relationship_id AND mi.engine_record_id = rid.record_id
            WHERE mi.deleted_at IS NOT NULL OR mi.superseded_at IS NOT NULL OR mi.source_invalidated_at IS NOT NULL);
    UPDATE vc.conversation_summary cs SET valid = false, summary = ''
     WHERE cs.owner_user_id = p_owner AND cs.prompt_version = 'st-memorycore-profile-v1'
       AND cs.conversation_id IN (SELECT id FROM vc.conversation WHERE owner_user_id = p_owner AND relationship_id = op.relationship_id);
    INSERT INTO vc.memory_profile(owner_user_id, relationship_id, fingerprint, persona, scenes, st_source_refs, record_ids, valid)
    VALUES (p_owner, op.relationship_id, p_fingerprint, p_persona, p_scenes, full_refs, full_ids, true)
    ON CONFLICT (owner_user_id, relationship_id, fingerprint) DO UPDATE
        SET persona = EXCLUDED.persona, scenes = EXCLUDED.scenes, st_source_refs = EXCLUDED.st_source_refs,
            record_ids = EXCLUDED.record_ids, valid = true, created_at = clock_timestamp()
    RETURNING id INTO profile_id;
    RETURN profile_id;
END;
$$;
