-- W12-A: one STORY conversation is one run. PostgreSQL stores the run, its root
-- branch, participants and committed events. The world definition stays in the
-- versioned fixture. Forks, rewind and outcomes belong to W14. Account deletion
-- cascades these rows through vc_user; there is no separate external receipt.
SET search_path TO vc, pg_catalog;

CREATE SEQUENCE vc.story_run_id_seq AS bigint;
CREATE SEQUENCE vc.story_branch_id_seq AS bigint;
CREATE SEQUENCE vc.story_participant_id_seq AS bigint;
CREATE SEQUENCE vc.story_event_id_seq AS bigint;

CREATE TABLE vc.story_run (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    case_id text NOT NULL,
    world_version bigint NOT NULL,
    stage text NOT NULL,
    conversation_id bigint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, conversation_id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT story_run_case_id_check CHECK (char_length(btrim(case_id)) BETWEEN 1 AND 64),
    CONSTRAINT story_run_stage_check CHECK (char_length(btrim(stage)) BETWEEN 1 AND 64),
    CONSTRAINT story_run_world_version_check CHECK (world_version >= 0)
);

CREATE TABLE vc.story_branch (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    parent_branch_id bigint,
    fork_world_version bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, run_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, run_id)
        REFERENCES vc.story_run(owner_user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, parent_branch_id)
        REFERENCES vc.story_branch(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT story_branch_fork_pair CHECK (
        (parent_branch_id IS NULL AND fork_world_version IS NULL)
        OR (parent_branch_id IS NOT NULL AND fork_world_version IS NOT NULL
            AND fork_world_version >= 0))
);

CREATE UNIQUE INDEX story_branch_one_root
    ON vc.story_branch(owner_user_id, run_id)
    WHERE parent_branch_id IS NULL;

CREATE TABLE vc.story_participant (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    actor_id text NOT NULL,
    role text NOT NULL,
    scene text NOT NULL,
    relationship_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, run_id, actor_id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, run_id)
        REFERENCES vc.story_run(owner_user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT story_participant_actor_check CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 64),
    CONSTRAINT story_participant_role_check CHECK (role IN ('player', 'npc')),
    CONSTRAINT story_participant_scene_check CHECK (char_length(btrim(scene)) BETWEEN 1 AND 64)
);

CREATE TABLE vc.story_event (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL,
    run_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    actor_id text NOT NULL,
    visibility text[] NOT NULL,
    world_version bigint NOT NULL,
    body jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, run_id)
        REFERENCES vc.story_run(owner_user_id, id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, run_id, branch_id)
        REFERENCES vc.story_branch(owner_user_id, run_id, id) ON DELETE CASCADE,
    CONSTRAINT story_event_actor_check CHECK (char_length(btrim(actor_id)) BETWEEN 1 AND 64),
    CONSTRAINT story_event_visibility_check CHECK (cardinality(visibility) > 0),
    CONSTRAINT story_event_world_version_check CHECK (world_version >= 0)
);

ALTER TABLE vc.story_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.story_run FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.story_branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.story_branch FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.story_participant ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.story_participant FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.story_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.story_event FORCE ROW LEVEL SECURITY;

CREATE POLICY owner_isolation ON vc.story_run
    TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.story_branch
    TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.story_participant
    TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.story_event
    TO vc_api, vc_worker
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.story_run, vc.story_branch, vc.story_participant, vc.story_event FROM PUBLIC;
GRANT SELECT ON vc.story_run, vc.story_branch, vc.story_participant, vc.story_event TO vc_api, vc_worker;
REVOKE ALL ON SEQUENCE vc.story_run_id_seq, vc.story_branch_id_seq,
    vc.story_participant_id_seq, vc.story_event_id_seq FROM PUBLIC;

CREATE TRIGGER story_run_deletion_intent_guard
    BEFORE INSERT OR UPDATE ON vc.story_run
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();
CREATE TRIGGER story_branch_deletion_intent_guard
    BEFORE INSERT OR UPDATE ON vc.story_branch
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();
CREATE TRIGGER story_participant_deletion_intent_guard
    BEFORE INSERT OR UPDATE ON vc.story_participant
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();
CREATE TRIGGER story_event_deletion_intent_guard
    BEFORE INSERT OR UPDATE ON vc.story_event
    FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE FUNCTION vc.story_run_requires_story_conversation()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.conversation c
        WHERE c.owner_user_id = NEW.owner_user_id
          AND c.id = NEW.conversation_id
          AND c.st_mode = 'STORY'
    ) THEN
        RAISE EXCEPTION 'story run requires a STORY conversation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER story_run_story_conversation
    BEFORE INSERT OR UPDATE OF conversation_id ON vc.story_run
    FOR EACH ROW EXECUTE FUNCTION vc.story_run_requires_story_conversation();

CREATE FUNCTION vc.story_conversation_mode_locked()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NEW.st_mode IS DISTINCT FROM 'STORY'
       AND EXISTS (
           SELECT 1 FROM vc.story_run r
           WHERE r.owner_user_id = OLD.owner_user_id AND r.conversation_id = OLD.id
       ) THEN
        RAISE EXCEPTION 'story run requires a STORY conversation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER story_conversation_mode_locked
    BEFORE UPDATE OF st_mode ON vc.conversation
    FOR EACH ROW EXECUTE FUNCTION vc.story_conversation_mode_locked();

CREATE FUNCTION vc.create_story_run(
    p_owner bigint,
    p_case_id text,
    p_world_version bigint,
    p_stage text,
    p_conversation_id bigint
)
    RETURNS TABLE(out_run_id bigint, out_branch_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_run bigint;
    v_branch bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_case_id IS NULL OR btrim(p_case_id) = '' OR char_length(p_case_id) > 64
       OR p_stage IS NULL OR btrim(p_stage) = '' OR char_length(p_stage) > 64
       OR p_world_version IS NULL OR p_world_version < 0
       OR p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'create_story_run: invalid input';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.conversation c
        WHERE c.owner_user_id = p_owner
          AND c.id = p_conversation_id
          AND c.st_mode = 'STORY'
    ) THEN
        RAISE EXCEPTION 'story run requires a STORY conversation';
    END IF;
    v_run := nextval('vc.story_run_id_seq');
    INSERT INTO vc.story_run(owner_user_id, id, case_id, world_version, stage, conversation_id)
    VALUES (p_owner, v_run, p_case_id, p_world_version, p_stage, p_conversation_id);
    v_branch := nextval('vc.story_branch_id_seq');
    INSERT INTO vc.story_branch(owner_user_id, id, run_id, parent_branch_id, fork_world_version)
    VALUES (p_owner, v_branch, v_run, NULL, NULL);
    RETURN QUERY SELECT v_run, v_branch;
END;
$$;

CREATE FUNCTION vc.add_story_participant(
    p_owner bigint,
    p_run_id bigint,
    p_actor_id text,
    p_role text,
    p_scene text,
    p_relationship_id bigint
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_actor_id IS NULL OR btrim(p_actor_id) = '' OR char_length(p_actor_id) > 64
       OR p_role IS NULL OR p_role NOT IN ('player', 'npc')
       OR p_scene IS NULL OR btrim(p_scene) = '' OR char_length(p_scene) > 64
       OR (p_relationship_id IS NOT NULL AND p_relationship_id <= 0) THEN
        RAISE EXCEPTION 'add_story_participant: invalid input';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.story_run r
        WHERE r.owner_user_id = p_owner AND r.id = p_run_id
    ) THEN
        RAISE EXCEPTION 'add_story_participant: run not found';
    END IF;
    v_id := nextval('vc.story_participant_id_seq');
    INSERT INTO vc.story_participant(
        owner_user_id, id, run_id, actor_id, role, scene, relationship_id)
    VALUES (p_owner, v_id, p_run_id, p_actor_id, p_role, p_scene, p_relationship_id);
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.append_story_event(
    p_owner bigint,
    p_run_id bigint,
    p_branch_id bigint,
    p_actor_id text,
    p_visibility text[],
    p_world_version bigint,
    p_body jsonb
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_version bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_branch_id IS NULL OR p_branch_id <= 0
       OR p_actor_id IS NULL OR btrim(p_actor_id) = '' OR char_length(p_actor_id) > 64
       OR p_visibility IS NULL OR cardinality(p_visibility) < 1
       OR p_world_version IS NULL OR p_world_version < 0
       OR p_body IS NULL THEN
        RAISE EXCEPTION 'append_story_event: invalid input';
    END IF;
    IF EXISTS (
        SELECT 1 FROM unnest(p_visibility) AS visible(actor_id)
        WHERE actor_id IS NULL OR btrim(actor_id) = ''
    ) THEN
        RAISE EXCEPTION 'append_story_event: invalid input';
    END IF;
    SELECT r.world_version INTO v_version
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id
     FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'append_story_event: run not found';
    END IF;
    IF v_version IS DISTINCT FROM p_world_version THEN
        RAISE EXCEPTION 'append_story_event: world_version does not match the run';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.story_branch b
        WHERE b.owner_user_id = p_owner AND b.id = p_branch_id AND b.run_id = p_run_id
    ) THEN
        RAISE EXCEPTION 'append_story_event: branch not found';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.story_participant p
        WHERE p.owner_user_id = p_owner AND p.run_id = p_run_id AND p.actor_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'append_story_event: actor is not a participant';
    END IF;
    v_id := nextval('vc.story_event_id_seq');
    INSERT INTO vc.story_event(
        owner_user_id, id, run_id, branch_id, actor_id, visibility, world_version, body)
    VALUES (p_owner, v_id, p_run_id, p_branch_id, p_actor_id, p_visibility, p_world_version, p_body);
    RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.story_run_requires_story_conversation(), vc.story_conversation_mode_locked() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.create_story_run(bigint, text, bigint, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.add_story_participant(bigint, bigint, text, text, text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.append_story_event(bigint, bigint, bigint, text, text[], bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.create_story_run(bigint, text, bigint, text, bigint),
    vc.add_story_participant(bigint, bigint, text, text, text, bigint),
    vc.append_story_event(bigint, bigint, bigint, text, text[], bigint, jsonb)
    TO vc_api, vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint) RENAME TO export_v2_owner_metadata_v145;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_v145(p_owner) || jsonb_build_object(
        'storyRuns', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'runId', r.id::text,
                'caseId', r.case_id,
                'worldVersion', r.world_version,
                'stage', r.stage,
                'conversationId', r.conversation_id::text,
                'branches', COALESCE((
                    SELECT jsonb_agg(jsonb_build_object(
                        'branchId', b.id::text,
                        'parentBranchId', b.parent_branch_id,
                        'forkWorldVersion', b.fork_world_version
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
                        'body', e.body
                    ) ORDER BY e.id)
                    FROM vc.story_event e
                    WHERE e.owner_user_id = r.owner_user_id AND e.run_id = r.id
                ), '[]'::jsonb)
            ) ORDER BY r.id)
            FROM vc.story_run r
            WHERE r.owner_user_id = p_owner
        ), '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint), vc.export_v2_owner_metadata_v145(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_v145(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
