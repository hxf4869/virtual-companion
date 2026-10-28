-- W14: current branch head, explicit ST chat identity, prefix read, and rewind.
-- A commit on an old head conflicts and does not insert a branch. Rewind
-- restores the prefix state and cancels incomplete projections after that point.
SET search_path TO vc, pg_catalog;

ALTER TABLE vc.story_run
    ADD COLUMN current_branch_id bigint;

UPDATE vc.story_run r
   SET current_branch_id = b.id
  FROM vc.story_branch b
 WHERE b.owner_user_id = r.owner_user_id
   AND b.run_id = r.id
   AND b.parent_branch_id IS NULL
   AND r.current_branch_id IS NULL;

ALTER TABLE vc.story_branch
    ADD COLUMN st_chat_identity text,
    ADD CONSTRAINT story_branch_st_chat_identity_check CHECK (
        st_chat_identity IS NULL
        OR (
            char_length(btrim(st_chat_identity)) BETWEEN 1 AND 200
            AND st_chat_identity = btrim(st_chat_identity)));

CREATE UNIQUE INDEX story_branch_st_chat_identity_per_owner
    ON vc.story_branch (owner_user_id, st_chat_identity)
    WHERE st_chat_identity IS NOT NULL;

-- Recreate the generic BEFORE trigger after the new column exists. An older
-- compiled NEW row would otherwise drop st_chat_identity on update.
CREATE OR REPLACE FUNCTION vc.block_deleting_owner_outbound_rows()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.account_id = NEW.owner_user_id) THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    RETURN NEW;
END;
$$;

-- The root branch cannot exist before the run, so the head is filled in after
-- the insert. Re-read the row at commit: a deferred trigger's NEW is the
-- statement image and is still null for that insert.
CREATE FUNCTION vc.story_run_current_branch_present()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_branch bigint;
BEGIN
    SELECT r.current_branch_id INTO v_branch
      FROM vc.story_run r
     WHERE r.owner_user_id = NEW.owner_user_id AND r.id = NEW.id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF v_branch IS NULL THEN
        RAISE EXCEPTION 'story run requires a current branch';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.story_branch b
        WHERE b.owner_user_id = NEW.owner_user_id
          AND b.id = v_branch
          AND b.run_id = NEW.id
    ) THEN
        RAISE EXCEPTION 'story run current branch is not in this run';
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER story_run_current_branch_present
    AFTER INSERT OR UPDATE OF current_branch_id ON vc.story_run
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION vc.story_run_current_branch_present();

CREATE OR REPLACE FUNCTION vc.create_story_run(
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
    v_state jsonb;
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
    v_state := jsonb_build_object(
        'items', '[]'::jsonb,
        'clues', '[]'::jsonb,
        'truth', '{}'::jsonb,
        'knowledge', '{}'::jsonb,
        'stage', to_jsonb(p_stage));
    v_run := nextval('vc.story_run_id_seq');
    INSERT INTO vc.story_run(
        owner_user_id, id, case_id, world_version, stage, conversation_id,
        initial_state, world_state)
    VALUES (
        p_owner, v_run, p_case_id, p_world_version, p_stage, p_conversation_id,
        v_state, v_state);
    v_branch := nextval('vc.story_branch_id_seq');
    INSERT INTO vc.story_branch(owner_user_id, id, run_id, parent_branch_id, fork_world_version)
    VALUES (p_owner, v_branch, v_run, NULL, NULL);
    UPDATE vc.story_run
       SET current_branch_id = v_branch
     WHERE owner_user_id = p_owner AND id = v_run;
    RETURN QUERY SELECT v_run, v_branch;
END;
$$;

CREATE OR REPLACE FUNCTION vc.append_story_event(
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
    v_head bigint;
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
    SELECT r.world_version, r.current_branch_id
      INTO v_version, v_head
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'append_story_event: run not found';
    END IF;
    IF v_head IS DISTINCT FROM p_branch_id THEN
        RAISE EXCEPTION 'story commit conflicts with the current branch';
    END IF;
    IF v_version IS DISTINCT FROM p_world_version THEN
        RAISE EXCEPTION 'append_story_event: world_version does not match the run';
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
    VALUES (
        p_owner, v_id, p_run_id, p_branch_id, p_actor_id, p_visibility,
        p_world_version, p_body);
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION vc.commit_story_event(
    p_owner bigint,
    p_run_id bigint,
    p_branch_id bigint,
    p_action_id text,
    p_expected_world_version bigint,
    p_kind text,
    p_actor_id text,
    p_visibility text[],
    p_body jsonb,
    p_world_state jsonb,
    p_stage text
)
    RETURNS TABLE(
        out_event_id bigint,
        out_world_version bigint,
        out_projection_id bigint,
        out_replayed boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_version bigint;
    v_stage text;
    v_world jsonb;
    v_head bigint;
    v_event bigint;
    v_event_version bigint;
    v_proj bigint;
    v_next bigint;
    v_next_stage text;
    v_next_state jsonb;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_branch_id IS NULL OR p_branch_id <= 0
       OR p_action_id IS NULL OR btrim(p_action_id) = ''
       OR char_length(p_action_id) > 128
       OR p_expected_world_version IS NULL OR p_expected_world_version < 0 THEN
        RAISE EXCEPTION 'commit_story_event: invalid input';
    END IF;

    SELECT r.world_version, r.stage, r.world_state, r.current_branch_id
      INTO v_version, v_stage, v_world, v_head
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'commit_story_event: run not found';
    END IF;

    SELECT e.id, e.world_version, w.id
      INTO v_event, v_event_version, v_proj
      FROM vc.story_event e
      LEFT JOIN vc.work_item w
        ON w.owner_user_id = e.owner_user_id
       AND w.ref_id = e.id
       AND w.kind = 'STORY_PROJECTION'
     WHERE e.owner_user_id = p_owner
       AND e.run_id = p_run_id
       AND e.action_id = p_action_id
     ORDER BY e.id
     LIMIT 1;
    IF FOUND THEN
        RETURN QUERY SELECT v_event, v_event_version, v_proj, true;
        RETURN;
    END IF;

    IF v_head IS DISTINCT FROM p_branch_id THEN
        RAISE EXCEPTION 'story commit conflicts with the current branch';
    END IF;
    IF v_version IS DISTINCT FROM p_expected_world_version THEN
        RAISE EXCEPTION 'story commit conflicts with world_version';
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('action', 'statement')
       OR p_actor_id IS NULL OR btrim(p_actor_id) = '' OR char_length(p_actor_id) > 64
       OR p_visibility IS NULL OR cardinality(p_visibility) < 1
       OR p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
        RAISE EXCEPTION 'commit_story_event: invalid input';
    END IF;
    IF EXISTS (
        SELECT 1 FROM unnest(p_visibility) AS visible(actor_id)
        WHERE actor_id IS NULL OR btrim(actor_id) = ''
    ) THEN
        RAISE EXCEPTION 'commit_story_event: invalid input';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.story_participant p
        WHERE p.owner_user_id = p_owner AND p.run_id = p_run_id AND p.actor_id = p_actor_id
    ) THEN
        RAISE EXCEPTION 'commit_story_event: actor is not a participant';
    END IF;

    IF p_kind = 'statement' THEN
        IF p_stage IS NOT NULL AND p_stage IS DISTINCT FROM v_stage THEN
            RAISE EXCEPTION 'story statement cannot change items or truth';
        END IF;
        IF p_world_state IS NOT NULL AND (
            jsonb_typeof(p_world_state) <> 'object'
            OR (p_world_state ? 'items'
                AND p_world_state->'items' IS DISTINCT FROM v_world->'items')
            OR (p_world_state ? 'clues'
                AND p_world_state->'clues' IS DISTINCT FROM v_world->'clues')
            OR (p_world_state ? 'truth'
                AND p_world_state->'truth' IS DISTINCT FROM v_world->'truth')
            OR (p_world_state ? 'knowledge'
                AND p_world_state->'knowledge' IS DISTINCT FROM v_world->'knowledge')
            OR (p_world_state ? 'stage'
                AND p_world_state->>'stage' IS DISTINCT FROM v_stage)
        ) THEN
            RAISE EXCEPTION 'story statement cannot change items or truth';
        END IF;
        v_next_stage := v_stage;
        v_next_state := v_world;
    ELSE
        IF p_stage IS NULL OR char_length(btrim(p_stage)) NOT BETWEEN 1 AND 64
           OR p_world_state IS NULL OR jsonb_typeof(p_world_state) <> 'object'
           OR jsonb_typeof(p_world_state->'items') <> 'array'
           OR jsonb_typeof(p_world_state->'clues') <> 'array'
           OR jsonb_typeof(p_world_state->'truth') <> 'object'
           OR jsonb_typeof(p_world_state->'knowledge') <> 'object' THEN
            RAISE EXCEPTION 'commit_story_event: invalid input';
        END IF;
        v_next_stage := p_stage;
        v_next_state := jsonb_build_object(
            'items', p_world_state->'items',
            'clues', p_world_state->'clues',
            'truth', p_world_state->'truth',
            'knowledge', p_world_state->'knowledge',
            'stage', to_jsonb(p_stage));
    END IF;

    v_next := v_version + 1;
    UPDATE vc.story_run
       SET world_version = v_next,
           world_state = v_next_state,
           stage = v_next_stage
     WHERE owner_user_id = p_owner
       AND id = p_run_id
       AND world_version = v_version;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'story commit conflicts with world_version';
    END IF;

    v_event := nextval('vc.story_event_id_seq');
    INSERT INTO vc.story_event(
        owner_user_id, id, run_id, branch_id, actor_id, visibility, world_version,
        body, action_id, kind, state_after, projection_state)
    VALUES (
        p_owner, v_event, p_run_id, p_branch_id, p_actor_id, p_visibility, v_next,
        p_body, p_action_id, p_kind, v_next_state, 'PENDING');
    v_proj := nextval('vc.work_item_id_seq');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (p_owner, v_proj, 'STORY_PROJECTION', v_event, 'PENDING');
    RETURN QUERY SELECT v_event, v_next, v_proj, false;
END;
$$;

CREATE FUNCTION vc.list_story_branch_events(p_owner bigint, p_branch_id bigint)
    RETURNS TABLE(
        out_event_id bigint,
        out_branch_id bigint,
        out_world_version bigint,
        out_actor_id text,
        out_action_id text,
        out_kind text,
        out_visibility text[],
        out_body jsonb)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_run bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_branch_id IS NULL OR p_branch_id <= 0 THEN
        RAISE EXCEPTION 'list_story_branch_events: invalid input';
    END IF;
    SELECT b.run_id INTO v_run
      FROM vc.story_branch b
     WHERE b.owner_user_id = p_owner AND b.id = p_branch_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'list_story_branch_events: branch not found';
    END IF;
    RETURN QUERY
    WITH RECURSIVE chain AS (
        SELECT b.id, b.parent_branch_id, b.fork_world_version, b.run_id,
               NULL::bigint AS max_version, 0 AS depth
          FROM vc.story_branch b
         WHERE b.owner_user_id = p_owner AND b.id = p_branch_id
        UNION ALL
        SELECT parent.id, parent.parent_branch_id, parent.fork_world_version, parent.run_id,
               child.fork_world_version, child.depth + 1
          FROM vc.story_branch parent
          JOIN chain child
            ON parent.owner_user_id = p_owner
           AND parent.id = child.parent_branch_id
           AND parent.run_id = child.run_id
         WHERE child.depth < 32
    )
    SELECT e.id, e.branch_id, e.world_version, e.actor_id, e.action_id, e.kind,
           e.visibility, e.body
      FROM vc.story_event e
      JOIN chain c ON c.id = e.branch_id
     WHERE e.owner_user_id = p_owner
       AND e.run_id = v_run
       AND (c.max_version IS NULL OR e.world_version <= c.max_version)
     ORDER BY e.world_version, e.id;
END;
$$;

CREATE FUNCTION vc.map_story_branch_chat(
    p_owner bigint,
    p_branch_id bigint,
    p_st_chat_identity text
)
    RETURNS boolean
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
    IF p_branch_id IS NULL OR p_branch_id <= 0
       OR p_st_chat_identity IS NULL
       OR char_length(btrim(p_st_chat_identity)) NOT BETWEEN 1 AND 200
       OR p_st_chat_identity IS DISTINCT FROM btrim(p_st_chat_identity) THEN
        RAISE EXCEPTION 'map_story_branch_chat: invalid input';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.story_branch b
        WHERE b.owner_user_id = p_owner
          AND b.st_chat_identity = p_st_chat_identity
          AND b.id <> p_branch_id
    ) THEN
        RAISE EXCEPTION 'map_story_branch_chat: chat identity is already mapped';
    END IF;
    UPDATE vc.story_branch
       SET st_chat_identity = p_st_chat_identity
     WHERE owner_user_id = p_owner AND id = p_branch_id
    RETURNING id INTO v_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'map_story_branch_chat: branch not found';
    END IF;
    RETURN true;
END;
$$;

CREATE FUNCTION vc.rewind_story(
    p_owner bigint,
    p_run_id bigint,
    p_to_world_version bigint,
    p_st_chat_identity text
)
    RETURNS TABLE(out_branch_id bigint, out_world_version bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_version bigint;
    v_head bigint;
    v_initial jsonb;
    v_state jsonb;
    v_stage text;
    v_new bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_run_id IS NULL OR p_run_id <= 0
       OR p_to_world_version IS NULL OR p_to_world_version < 0
       OR p_st_chat_identity IS NULL
       OR char_length(btrim(p_st_chat_identity)) NOT BETWEEN 1 AND 200
       OR p_st_chat_identity IS DISTINCT FROM btrim(p_st_chat_identity) THEN
        RAISE EXCEPTION 'rewind_story: invalid input';
    END IF;
    SELECT r.world_version, r.current_branch_id, r.initial_state
      INTO v_version, v_head, v_initial
      FROM vc.story_run r
     WHERE r.owner_user_id = p_owner AND r.id = p_run_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'rewind_story: run not found';
    END IF;
    IF p_to_world_version >= v_version THEN
        RAISE EXCEPTION 'rewind_story: target is not before the current world';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.story_branch b
        WHERE b.owner_user_id = p_owner AND b.st_chat_identity = p_st_chat_identity
    ) THEN
        RAISE EXCEPTION 'rewind_story: chat identity is already mapped';
    END IF;

    v_new := nextval('vc.story_branch_id_seq');
    INSERT INTO vc.story_branch(
        owner_user_id, id, run_id, parent_branch_id, fork_world_version, st_chat_identity)
    VALUES (p_owner, v_new, p_run_id, v_head, p_to_world_version, p_st_chat_identity);

    WITH RECURSIVE chain AS (
        SELECT b.id, b.parent_branch_id, b.fork_world_version, b.run_id,
               NULL::bigint AS max_version, 0 AS depth
          FROM vc.story_branch b
         WHERE b.owner_user_id = p_owner AND b.id = v_new
        UNION ALL
        SELECT parent.id, parent.parent_branch_id, parent.fork_world_version, parent.run_id,
               child.fork_world_version, child.depth + 1
          FROM vc.story_branch parent
          JOIN chain child
            ON parent.owner_user_id = p_owner
           AND parent.id = child.parent_branch_id
           AND parent.run_id = child.run_id
         WHERE child.depth < 32
    )
    SELECT e.state_after INTO v_state
      FROM vc.story_event e
      JOIN chain c ON c.id = e.branch_id
     WHERE e.owner_user_id = p_owner
       AND e.run_id = p_run_id
       AND e.state_after IS NOT NULL
       AND e.world_version <= p_to_world_version
       AND (c.max_version IS NULL OR e.world_version <= c.max_version)
     ORDER BY e.world_version DESC, e.id DESC
     LIMIT 1;
    IF v_state IS NULL THEN
        v_state := v_initial;
    END IF;
    v_stage := v_state->>'stage';
    IF v_stage IS NULL OR char_length(btrim(v_stage)) NOT BETWEEN 1 AND 64 THEN
        RAISE EXCEPTION 'rewind_story: prefix state has no stage';
    END IF;
    UPDATE vc.story_run
       SET current_branch_id = v_new,
           world_version = p_to_world_version,
           world_state = v_state,
           stage = v_stage
     WHERE owner_user_id = p_owner AND id = p_run_id;

    WITH RECURSIVE chain AS (
        SELECT b.id, b.parent_branch_id, b.fork_world_version, b.run_id,
               NULL::bigint AS max_version, 0 AS depth
          FROM vc.story_branch b
         WHERE b.owner_user_id = p_owner AND b.id = v_new
        UNION ALL
        SELECT parent.id, parent.parent_branch_id, parent.fork_world_version, parent.run_id,
               child.fork_world_version, child.depth + 1
          FROM vc.story_branch parent
          JOIN chain child
            ON parent.owner_user_id = p_owner
           AND parent.id = child.parent_branch_id
           AND parent.run_id = child.run_id
         WHERE child.depth < 32
    )
    UPDATE vc.story_event e
       SET projection_state = 'CANCELLED'
     WHERE e.owner_user_id = p_owner
       AND e.run_id = p_run_id
       AND e.projection_state = 'PENDING'
       AND NOT EXISTS (
            SELECT 1 FROM chain c
             WHERE c.id = e.branch_id
               AND (c.max_version IS NULL OR e.world_version <= c.max_version)
       );
    UPDATE vc.work_item w
       SET status = 'CANCELLED',
           finished_at = clock_timestamp()
     WHERE w.owner_user_id = p_owner
       AND w.kind = 'STORY_PROJECTION'
       AND w.status IN ('PENDING', 'CLAIMED')
       AND EXISTS (
            SELECT 1 FROM vc.story_event e
             WHERE e.owner_user_id = w.owner_user_id
               AND e.id = w.ref_id
               AND e.run_id = p_run_id
               AND e.projection_state = 'CANCELLED'
       );
    RETURN QUERY SELECT v_new, p_to_world_version;
END;
$$;

REVOKE ALL ON FUNCTION vc.story_run_current_branch_present() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.list_story_branch_events(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.map_story_branch_chat(bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.rewind_story(bigint, bigint, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_story_branch_events(bigint, bigint),
    vc.map_story_branch_chat(bigint, bigint, text),
    vc.rewind_story(bigint, bigint, bigint, text)
    TO vc_api, vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint)
    RENAME TO export_v2_owner_metadata_w14_branch;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_w14_branch(p_owner);
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint),
    vc.export_v2_owner_metadata_w14_branch(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_w14_branch(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
