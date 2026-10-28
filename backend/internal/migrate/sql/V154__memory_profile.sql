-- Character-instance profiles are cached by the W07 allowlist fingerprint.
-- Persona and scenes stay plaintext. Legacy per-chat engine profiles leave the read path.
SET search_path=vc,pg_catalog;

CREATE SEQUENCE vc.memory_profile_id_seq AS bigint;
CREATE TABLE vc.memory_profile (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.memory_profile_id_seq'),
    relationship_id bigint NOT NULL,
    fingerprint text NOT NULL,
    persona text NOT NULL,
    scenes jsonb NOT NULL DEFAULT '[]'::jsonb,
    st_source_refs text[] NOT NULL,
    record_ids text[] NOT NULL,
    valid boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, relationship_id, fingerprint),
    FOREIGN KEY (owner_user_id, relationship_id) REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE);
ALTER SEQUENCE vc.memory_profile_id_seq OWNED BY vc.memory_profile.id;
ALTER TABLE vc.memory_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memory_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.memory_profile FOR ALL TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id()) WITH CHECK (owner_user_id = vc.current_owner_id());
REVOKE ALL ON vc.memory_profile FROM PUBLIC;
GRANT SELECT ON vc.memory_profile TO vc_api, vc_worker;
GRANT USAGE, SELECT ON SEQUENCE vc.memory_profile_id_seq TO vc_api, vc_worker;

UPDATE vc.conversation_summary SET valid=false, summary='' WHERE prompt_version='st-memorycore-profile-v1';

-- Same predicate at build and recall: present, settled, eligible, not suppressed, COMPANION, and W07 branch/SESSION.
CREATE FUNCTION vc.memory_profile_source_allowed(p_owner bigint, p_conv bigint, p_ref text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT EXISTS (
        SELECT 1 FROM vc.st_message_source src
        JOIN vc.conversation origin ON (origin.owner_user_id, origin.id) = (src.owner_user_id, src.conversation_id)
        JOIN vc.conversation target ON target.owner_user_id = p_owner AND target.id = p_conv
        JOIN vc.relationship rel ON (rel.owner_user_id, rel.id) = (target.owner_user_id, target.relationship_id)
        WHERE src.owner_user_id = p_owner AND src.source_ref = p_ref
          AND origin.relationship_id = target.relationship_id
          AND origin.st_mode = 'COMPANION' AND origin.st_source_state = 'PRESENT' AND NOT origin.incognito
          AND src.present AND src.settled AND src.eligible AND NOT src.suppressed
          AND (origin.id = target.id OR (rel.memory_share_scope <> 'SESSION'
              AND COALESCE(origin.st_branch_root, origin.st_chat_identity) <> COALESCE(target.st_branch_root, target.st_chat_identity))));
$$;

-- One row per allowed record source. A cross-chat merge stays out unless it is a correction successor.
CREATE FUNCTION vc.memory_profile_allowlist(p_owner bigint, p_rel bigint, p_conv bigint)
RETURNS TABLE(record_id text, version bigint, source_ref text, source_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE share text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT r.memory_share_scope INTO share FROM vc.relationship r WHERE r.owner_user_id = p_owner AND r.id = p_rel;
    IF NOT FOUND THEN RETURN; END IF;
    RETURN QUERY
    SELECT m.engine_record_id, m.engine_version, e.source_ref, src.source_revision
      FROM vc.memory_item m
      JOIN vc.memory_evidence e ON (e.owner_user_id, e.memory_item_id) = (m.owner_user_id, m.id)
      JOIN vc.st_message_source src ON src.owner_user_id = e.owner_user_id AND src.source_ref = e.source_ref
     WHERE m.owner_user_id = p_owner AND m.relationship_id = p_rel
       AND m.status = 'ACCEPTED' AND m.deleted_at IS NULL AND m.superseded_at IS NULL AND m.source_invalidated_at IS NULL
       AND (m.event_expires_at IS NULL OR m.event_expires_at >= now())
       AND ((m.scope = 'SESSION' AND m.conversation_id = p_conv) OR (m.scope = 'RELATIONSHIP' AND share <> 'SESSION'))
       AND m.engine_record_id IS NOT NULL AND m.engine_version IS NOT NULL
       AND vc.st_memory_scope_allowed(p_owner, p_conv, m.id)
       AND vc.st_memory_sources_valid(p_owner, m.id)
       AND e.source_ref LIKE 'st:%'
       AND (
            (SELECT count(DISTINCT split_part(ev.source_ref, ':', 2)) FROM vc.memory_evidence ev
              WHERE ev.owner_user_id = m.owner_user_id AND ev.memory_item_id = m.id AND ev.source_ref LIKE 'st:%') <= 1
            OR m.supersedes_memory_id IS NOT NULL)
       AND NOT EXISTS (
            SELECT 1 FROM vc.memory_evidence ev
             WHERE ev.owner_user_id = m.owner_user_id AND ev.memory_item_id = m.id AND ev.source_ref LIKE 'st:%'
               AND NOT vc.memory_profile_source_allowed(p_owner, p_conv, ev.source_ref))
       AND vc.memory_profile_source_allowed(p_owner, p_conv, e.source_ref)
     ORDER BY m.engine_record_id, e.source_ref, src.source_revision;
END;
$$;

-- Stable allowlist text. Not a digest: record id, version, source ref and source revision, in order.
CREATE FUNCTION vc.memory_profile_fingerprint(p_owner bigint, p_rel bigint, p_conv bigint) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT COALESCE(string_agg(record_id || '@' || version::text || '=' || source_ref || '#' || source_revision::text,
        E'\n' ORDER BY record_id, source_ref, source_revision), '')
      FROM vc.memory_profile_allowlist(p_owner, p_rel, p_conv);
$$;

CREATE FUNCTION vc.memory_profile_current(p_owner bigint, p_rel bigint, p_conv bigint)
RETURNS TABLE(out_id bigint, out_persona text, out_scenes jsonb, out_refs text[], out_record_ids text[], out_fingerprint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE fp text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    fp := vc.memory_profile_fingerprint(p_owner, p_rel, p_conv);
    IF fp IS NULL OR fp = '' THEN RETURN; END IF;
    RETURN QUERY
    SELECT mp.id, mp.persona, mp.scenes, mp.st_source_refs, mp.record_ids, mp.fingerprint
      FROM vc.memory_profile mp
     WHERE mp.owner_user_id = p_owner AND mp.relationship_id = p_rel AND mp.valid AND mp.fingerprint = fp
       AND btrim(mp.persona) <> ''
       AND NOT EXISTS (
            SELECT 1 FROM unnest(mp.st_source_refs) AS ref(source_ref)
             WHERE NOT vc.memory_profile_source_allowed(p_owner, p_conv, ref.source_ref))
       AND NOT EXISTS (
            SELECT 1 FROM unnest(mp.record_ids) AS rid(record_id)
             WHERE NOT EXISTS (
                SELECT 1 FROM vc.memory_profile_allowlist(p_owner, p_rel, p_conv) a WHERE a.record_id = rid.record_id));
END;
$$;

CREATE FUNCTION vc.memory_profile_fallback(p_owner bigint, p_rel bigint, p_conv bigint)
RETURNS TABLE(out_id bigint, out_summary text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
    SELECT DISTINCT m.id, m.summary
      FROM vc.memory_profile_allowlist(p_owner, p_rel, p_conv) a
      JOIN vc.memory_item m ON m.owner_user_id = p_owner AND m.relationship_id = p_rel AND m.engine_record_id = a.record_id
       AND m.status = 'ACCEPTED' AND m.deleted_at IS NULL AND m.superseded_at IS NULL AND m.source_invalidated_at IS NULL
     ORDER BY m.id;
END;
$$;

-- Rebuild one finished extraction. A PENDING forget or correction job keeps its marker.
CREATE FUNCTION vc.go_enqueue_memory_profile_rebuild(p_owner bigint, p_rel bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE rebuild_job bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT op.job_id INTO rebuild_job
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
    UPDATE vc.work_item SET status = 'PENDING', attempt_count = 0, next_attempt_at = NULL,
        claim_token = NULL, claim_fence = NULL, claimed_at = NULL, lease_expires_at = NULL, finished_at = NULL
     WHERE owner_user_id = p_owner AND id = rebuild_job AND status IN ('DONE', 'FAILED', 'DEAD_LETTERED');
    IF NOT FOUND THEN RETURN; END IF;
    UPDATE vc.memorycore_operation SET profile_operation_id = 'recall-' || p_rel::text || '-profile'
     WHERE owner_user_id = p_owner AND job_id = rebuild_job;
END;
$$;

DROP FUNCTION vc.go_record_memorycore_profile(bigint, bigint, text, text, text[], text);
CREATE FUNCTION vc.go_record_memorycore_profile(
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
        IF NOT vc.guard_st_memory_source(p_owner, op.relationship_id, ref) THEN RAISE EXCEPTION 'profile source invalid'; END IF;
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
REVOKE ALL ON FUNCTION vc.go_record_memorycore_profile(bigint, bigint, text, text, text[], text, jsonb, text[], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_record_memorycore_profile(bigint, bigint, text, text, text[], text, jsonb, text[], text) TO vc_api, vc_worker;

CREATE OR REPLACE FUNCTION vc.read_st_summaries(p_owner bigint, p_conversations bigint[], p_target bigint)
RETURNS TABLE(out_id bigint, out_conversation bigint, out_summary text, out_refs text[], out_created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT s.id, s.conversation_id, s.summary, s.st_source_refs, s.created_at FROM vc.conversation_summary s
      WHERE s.owner_user_id = p_owner AND s.conversation_id = ANY(p_conversations) AND s.valid AND btrim(s.summary) <> ''
        AND cardinality(s.st_source_refs) > 0 AND s.prompt_version IS DISTINCT FROM 'st-memorycore-profile-v1'
        AND EXISTS (SELECT 1 FROM vc.conversation target
          JOIN vc.relationship r ON (r.owner_user_id, r.id) = (target.owner_user_id, target.relationship_id)
          JOIN vc.conversation origin ON origin.owner_user_id = target.owner_user_id AND origin.relationship_id = target.relationship_id
          WHERE target.owner_user_id = p_owner AND target.id = p_target AND origin.id = s.conversation_id
            AND target.st_mode = 'COMPANION' AND origin.st_mode = 'COMPANION' AND NOT target.incognito AND NOT origin.incognito
            AND target.st_source_state = 'PRESENT'
            AND (origin.id = target.id OR (r.memory_share_scope <> 'SESSION'
                AND COALESCE(origin.st_branch_root, origin.st_chat_identity) <> COALESCE(target.st_branch_root, target.st_chat_identity))))
        AND NOT EXISTS (SELECT 1 FROM unnest(s.st_source_refs) ref WHERE NOT EXISTS (
          SELECT 1 FROM vc.st_message_source m
          JOIN vc.conversation c ON (c.owner_user_id, c.id) = (m.owner_user_id, m.conversation_id)
          JOIN vc.conversation target ON target.owner_user_id = p_owner AND target.id = p_target AND target.relationship_id = c.relationship_id
          JOIN vc.relationship r ON (r.owner_user_id, r.id) = (target.owner_user_id, target.relationship_id)
          WHERE m.owner_user_id = p_owner AND m.source_ref = ref AND m.present AND m.settled AND m.eligible AND NOT m.suppressed
            AND c.st_source_state = 'PRESENT' AND c.st_mode = 'COMPANION' AND NOT c.incognito
            AND (c.id = target.id OR (r.memory_share_scope <> 'SESSION'
                AND COALESCE(c.st_branch_root, c.st_chat_identity) <> COALESCE(target.st_branch_root, target.st_chat_identity)))))
      ORDER BY s.created_at DESC, s.id DESC;
END;
$$;

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
REVOKE ALL ON FUNCTION vc.memory_erase_forgotten_wording(bigint, bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION vc.memory_correction_publish(p_owner bigint, p_id bigint, p_operation text, p_record text, p_engine_version bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; new_id bigint; refs text[]; rev bigint; rebuild_job bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
    SELECT * INTO m FROM vc.memory_item WHERE owner_user_id = p_owner AND id = p_id FOR UPDATE;
    IF NOT FOUND OR m.correction_operation_id IS DISTINCT FROM p_operation THEN RETURN 0; END IF;
    IF m.superseded_by_memory_id IS NOT NULL THEN RETURN m.superseded_by_memory_id; END IF;
    SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id = p_owner AND relationship_id = m.relationship_id FOR UPDATE;
    IF m.deleted_at IS NOT NULL OR m.source_invalidated_at IS NOT NULL OR m.correction_revision IS DISTINCT FROM rev OR NOT vc.st_memory_sources_valid(p_owner, p_id) THEN RETURN 0; END IF;
    SELECT array_agg(source_ref ORDER BY id) INTO refs FROM vc.memory_evidence WHERE owner_user_id = p_owner AND memory_item_id = p_id;
    new_id := vc.create_memory_candidate(p_owner, m.relationship_id, m.scope, m.correction_summary, m.conversation_id, refs);
    PERFORM vc.confirm_memory_candidate(p_owner, new_id, p_id);
    UPDATE vc.memory_item SET management_version = m.management_version + 1, supersedes_memory_id = m.id, engine_record_id = p_record, engine_version = p_engine_version, engine_operation_id = p_operation WHERE owner_user_id = p_owner AND id = new_id;
    UPDATE vc.conversation_summary SET valid = false WHERE owner_user_id = p_owner AND conversation_id IN (SELECT id FROM vc.conversation WHERE owner_user_id = p_owner AND relationship_id = m.relationship_id);
    UPDATE vc.memory_profile SET valid = false, persona = '', scenes = '[]'::jsonb
     WHERE owner_user_id = p_owner AND relationship_id = m.relationship_id
       AND m.engine_record_id IS NOT NULL AND m.engine_record_id = ANY(record_ids);
    SELECT op.job_id INTO rebuild_job FROM vc.memorycore_operation op
      JOIN vc.st_message_source src ON (src.owner_user_id, src.id) = (op.owner_user_id, op.source_id)
     WHERE op.owner_user_id = p_owner AND op.relationship_id = m.relationship_id AND op.state = 'PUBLISHED' AND src.source_ref = ANY(refs)
     ORDER BY op.job_id DESC LIMIT 1;
    IF rebuild_job IS NOT NULL THEN
        UPDATE vc.memorycore_operation SET profile_operation_id = p_operation || '-profile', revision = rev WHERE owner_user_id = p_owner AND job_id = rebuild_job;
        UPDATE vc.work_item SET status = 'PENDING', attempt_count = 0, next_attempt_at = NULL, claim_token = NULL, claim_fence = NULL, claimed_at = NULL, lease_expires_at = NULL, finished_at = NULL WHERE owner_user_id = p_owner AND id = rebuild_job;
    END IF;
    RETURN new_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.memory_profile_source_allowed(bigint, bigint, text),
    vc.memory_profile_allowlist(bigint, bigint, bigint),
    vc.memory_profile_fingerprint(bigint, bigint, bigint),
    vc.memory_profile_current(bigint, bigint, bigint),
    vc.memory_profile_fallback(bigint, bigint, bigint),
    vc.go_enqueue_memory_profile_rebuild(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_profile_source_allowed(bigint, bigint, text),
    vc.memory_profile_allowlist(bigint, bigint, bigint),
    vc.memory_profile_fingerprint(bigint, bigint, bigint),
    vc.memory_profile_current(bigint, bigint, bigint),
    vc.memory_profile_fallback(bigint, bigint, bigint),
    vc.go_enqueue_memory_profile_rebuild(bigint, bigint) TO vc_api, vc_worker;
