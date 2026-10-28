-- W14: ending mark and one shared-play summary. Discard writes no memory.
-- Save creates one pending candidate for a relationship already mapped on
-- the run and does not confirm it.
SET search_path TO vc, pg_catalog;

ALTER TABLE vc.story_run
    ADD COLUMN ending_code text,
    ADD COLUMN ended_at timestamptz,
    ADD CONSTRAINT story_run_ending_pair CHECK (
        (ending_code IS NULL AND ended_at IS NULL)
        OR (
            ending_code IS NOT NULL
            AND char_length(btrim(ending_code)) BETWEEN 1 AND 64
            AND ended_at IS NOT NULL));

CREATE TABLE vc.story_epilogue (
    owner_user_id bigint NOT NULL,
    run_id bigint NOT NULL,
    decision text NOT NULL,
    relationship_id bigint,
    summary text,
    memory_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, run_id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user (id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, run_id)
        REFERENCES vc.story_run (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT story_epilogue_decision_check CHECK (decision IN ('save', 'discard')),
    CONSTRAINT story_epilogue_discard_empty CHECK (
        decision <> 'discard'
        OR (relationship_id IS NULL AND summary IS NULL AND memory_id IS NULL)),
    CONSTRAINT story_epilogue_save_complete CHECK (
        decision <> 'save'
        OR (
            relationship_id IS NOT NULL
            AND summary IS NOT NULL
            AND btrim(summary) <> ''
            AND memory_id IS NOT NULL)));

ALTER TABLE vc.story_epilogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.story_epilogue FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.story_epilogue
    TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.story_epilogue FROM PUBLIC;
GRANT SELECT ON vc.story_epilogue TO vc_api, vc_worker;

CREATE TRIGGER story_epilogue_deletion_intent_guard
    BEFORE INSERT OR UPDATE ON vc.story_epilogue
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE FUNCTION vc.mark_story_ending(
    p_owner bigint,
    p_run_id bigint,
    p_ending_code text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_code text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_ending_code IS NULL
       OR char_length(btrim(p_ending_code)) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION 'mark_story_ending: invalid input';
    END IF;
    SELECT r.ending_code INTO v_code
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'mark_story_ending: run not found';
    END IF;
    IF v_code IS NULL THEN
        UPDATE vc.story_run
           SET ending_code = p_ending_code,
               ended_at = clock_timestamp()
         WHERE owner_user_id = p_owner AND id = p_run_id;
        RETURN true;
    END IF;
    IF v_code = p_ending_code THEN
        RETURN true;
    END IF;
    RAISE EXCEPTION 'story ending is already marked';
END;
$$;

CREATE FUNCTION vc.decide_story_epilogue(
    p_owner bigint,
    p_run_id bigint,
    p_decision text,
    p_relationship_id bigint,
    p_summary text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_ending text;
    v_decision text;
    v_relationship bigint;
    v_summary text;
    v_memory bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_decision IS NULL OR p_decision NOT IN ('save', 'discard') THEN
        RAISE EXCEPTION 'decide_story_epilogue: invalid input';
    END IF;
    SELECT r.ending_code INTO v_ending
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'decide_story_epilogue: run not found';
    END IF;
    IF v_ending IS NULL THEN
        RAISE EXCEPTION 'story epilogue requires an ending';
    END IF;
    SELECT e.decision, e.relationship_id, e.summary, e.memory_id
      INTO v_decision, v_relationship, v_summary, v_memory
      FROM vc.story_epilogue e
     WHERE e.owner_user_id = p_owner AND e.run_id = p_run_id
     FOR UPDATE;
    IF FOUND THEN
        IF p_decision = 'discard' AND v_decision = 'discard'
           AND p_relationship_id IS NULL AND p_summary IS NULL THEN
            RETURN NULL;
        END IF;
        IF p_decision = 'save' AND v_decision = 'save'
           AND v_relationship IS NOT DISTINCT FROM p_relationship_id
           AND v_summary IS NOT DISTINCT FROM p_summary THEN
            RETURN v_memory;
        END IF;
        RAISE EXCEPTION 'story epilogue is already decided';
    END IF;
    IF p_decision = 'discard' THEN
        IF p_relationship_id IS NOT NULL OR p_summary IS NOT NULL THEN
            RAISE EXCEPTION 'decide_story_epilogue: invalid input';
        END IF;
        INSERT INTO vc.story_epilogue(
            owner_user_id, run_id, decision, relationship_id, summary, memory_id)
        VALUES (p_owner, p_run_id, 'discard', NULL, NULL, NULL);
        RETURN NULL;
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0
       OR p_summary IS NULL OR btrim(p_summary) = '' THEN
        RAISE EXCEPTION 'decide_story_epilogue: invalid input';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.story_participant p
        WHERE p.owner_user_id = p_owner
          AND p.run_id = p_run_id
          AND p.relationship_id = p_relationship_id
          AND p.actor_id IN ('lin', 'zhou', 'su')
    ) THEN
        RAISE EXCEPTION 'story epilogue relationship is not mapped on this run';
    END IF;
    v_memory := vc.create_memory_candidate(
        p_owner, p_relationship_id, 'RELATIONSHIP', p_summary, NULL);
    INSERT INTO vc.story_epilogue(
        owner_user_id, run_id, decision, relationship_id, summary, memory_id)
    VALUES (p_owner, p_run_id, 'save', p_relationship_id, p_summary, v_memory);
    RETURN v_memory;
END;
$$;

CREATE FUNCTION vc.export_w14_story_runs(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'runId', r.id::text,
            'caseId', r.case_id,
            'worldVersion', r.world_version,
            'stage', r.stage,
            'conversationId', r.conversation_id::text,
            'currentBranchId', r.current_branch_id,
            'endingCode', r.ending_code,
            'endedAt', r.ended_at,
            'worldState', r.world_state,
            'epilogue', (
                SELECT jsonb_build_object(
                    'decision', e.decision,
                    'relationshipId', e.relationship_id,
                    'memoryId', e.memory_id,
                    'summary', e.summary)
                  FROM vc.story_epilogue e
                 WHERE e.owner_user_id = r.owner_user_id AND e.run_id = r.id
            ),
            'branches', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'branchId', b.id::text,
                    'parentBranchId', b.parent_branch_id,
                    'forkWorldVersion', b.fork_world_version,
                    'stChatIdentity', b.st_chat_identity
                ) ORDER BY b.id)
                  FROM vc.story_branch b
                 WHERE b.owner_user_id = r.owner_user_id AND b.run_id = r.id
            ), '[]'::jsonb),
            'participants', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'participantId', p.id::text,
                    'actorId', p.actor_id,
                    'role', p.role,
                    'scene', p.scene,
                    'relationshipId', p.relationship_id
                ) ORDER BY p.id)
                  FROM vc.story_participant p
                 WHERE p.owner_user_id = r.owner_user_id AND p.run_id = r.id
            ), '[]'::jsonb),
            'events', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'eventId', e.id::text,
                    'branchId', e.branch_id::text,
                    'actorId', e.actor_id,
                    'visibility', to_jsonb(e.visibility),
                    'worldVersion', e.world_version,
                    'body', e.body,
                    'actionId', e.action_id,
                    'kind', e.kind,
                    'projectionState', e.projection_state
                ) ORDER BY e.id)
                  FROM vc.story_event e
                 WHERE e.owner_user_id = r.owner_user_id AND e.run_id = r.id
            ), '[]'::jsonb)
        ) ORDER BY r.id)
          FROM vc.story_run r
         WHERE r.owner_user_id = p_owner
    ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION vc.mark_story_ending(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.decide_story_epilogue(bigint, bigint, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_w14_story_runs(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.mark_story_ending(bigint, bigint, text),
    vc.decide_story_epilogue(bigint, bigint, text, bigint, text)
    TO vc_api, vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint)
    RENAME TO export_v2_owner_metadata_w14_epilogue;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN (vc.export_v2_owner_metadata_w14_epilogue(p_owner) - 'storyRuns')
        || jsonb_build_object('storyRuns', vc.export_w14_story_runs(p_owner));
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint),
    vc.export_v2_owner_metadata_w14_epilogue(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_w14_epilogue(bigint)
    FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
