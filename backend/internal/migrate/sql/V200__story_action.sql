-- W14: atomic action and statement commit. Rules stay in Go. This migration
-- only advances world_version when the expected version matches, keeps one row
-- per action_id, and enqueues one STORY_PROJECTION work item for the event.
-- The current branch head is added in V201.
SET search_path TO vc, pg_catalog;

ALTER TABLE vc.story_run
    ADD COLUMN initial_state jsonb NOT NULL
        DEFAULT '{"items":[],"clues":[],"truth":{},"knowledge":{},"stage":null}'::jsonb,
    ADD COLUMN world_state jsonb NOT NULL
        DEFAULT '{"items":[],"clues":[],"truth":{},"knowledge":{},"stage":null}'::jsonb;

ALTER TABLE vc.story_event
    ADD COLUMN action_id text,
    ADD COLUMN kind text,
    ADD COLUMN state_after jsonb,
    ADD COLUMN projection_state text,
    ADD CONSTRAINT story_event_action_id_check CHECK (
        action_id IS NULL OR char_length(btrim(action_id)) BETWEEN 1 AND 128),
    ADD CONSTRAINT story_event_kind_check CHECK (
        kind IS NULL OR kind IN ('action', 'statement')),
    ADD CONSTRAINT story_event_projection_state_check CHECK (
        projection_state IS NULL
        OR projection_state IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'USER_DELETED'));

CREATE UNIQUE INDEX story_event_action_once
    ON vc.story_event (owner_user_id, run_id, action_id)
    WHERE action_id IS NOT NULL;

CREATE UNIQUE INDEX work_item_story_projection_once
    ON vc.work_item (owner_user_id, ref_id)
    WHERE kind = 'STORY_PROJECTION';

CREATE FUNCTION vc.commit_story_event(
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

    SELECT r.world_version, r.stage, r.world_state
      INTO v_version, v_stage, v_world
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

    IF NOT EXISTS (
        SELECT 1 FROM vc.story_branch b
        WHERE b.owner_user_id = p_owner AND b.id = p_branch_id AND b.run_id = p_run_id
    ) THEN
        RAISE EXCEPTION 'commit_story_event: branch not found';
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

CREATE FUNCTION vc.ensure_story_projection(p_owner bigint, p_event_id bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_state text;
    v_proj bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_event_id IS NULL OR p_event_id <= 0 THEN
        RAISE EXCEPTION 'ensure_story_projection: invalid input';
    END IF;
    SELECT e.projection_state INTO v_state
      FROM vc.story_event e
     WHERE e.owner_user_id = p_owner AND e.id = p_event_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ensure_story_projection: event not found';
    END IF;
    SELECT w.id INTO v_proj
      FROM vc.work_item w
     WHERE w.owner_user_id = p_owner
       AND w.kind = 'STORY_PROJECTION'
       AND w.ref_id = p_event_id;
    IF FOUND THEN
        RETURN v_proj;
    END IF;
    IF v_state IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'ensure_story_projection: projection is closed';
    END IF;
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    v_proj := nextval('vc.work_item_id_seq');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (p_owner, v_proj, 'STORY_PROJECTION', p_event_id, 'PENDING');
    RETURN v_proj;
END;
$$;

CREATE FUNCTION vc.confirm_story_projection(p_owner bigint, p_event_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_state text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_event_id IS NULL OR p_event_id <= 0 THEN
        RAISE EXCEPTION 'confirm_story_projection: invalid input';
    END IF;
    SELECT e.projection_state INTO v_state
      FROM vc.story_event e
     WHERE e.owner_user_id = p_owner AND e.id = p_event_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'confirm_story_projection: event not found';
    END IF;
    IF v_state = 'USER_DELETED' OR v_state = 'CANCELLED' THEN
        RETURN false;
    END IF;
    IF v_state = 'CONFIRMED' THEN
        RETURN true;
    END IF;
    IF v_state IS DISTINCT FROM 'PENDING' THEN
        RETURN false;
    END IF;
    UPDATE vc.story_event
       SET projection_state = 'CONFIRMED'
     WHERE owner_user_id = p_owner AND id = p_event_id;
    UPDATE vc.work_item
       SET status = 'DONE',
           finished_at = clock_timestamp()
     WHERE owner_user_id = p_owner
       AND kind = 'STORY_PROJECTION'
       AND ref_id = p_event_id
       AND status IN ('PENDING', 'CLAIMED');
    RETURN true;
END;
$$;

CREATE FUNCTION vc.record_story_projection_deleted(p_owner bigint, p_event_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_state text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF p_event_id IS NULL OR p_event_id <= 0 THEN
        RAISE EXCEPTION 'record_story_projection_deleted: invalid input';
    END IF;
    SELECT e.projection_state INTO v_state
      FROM vc.story_event e
     WHERE e.owner_user_id = p_owner AND e.id = p_event_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_story_projection_deleted: event not found';
    END IF;
    IF v_state = 'USER_DELETED' THEN
        RETURN true;
    END IF;
    IF v_state IS DISTINCT FROM 'CONFIRMED' THEN
        RAISE EXCEPTION 'story projection is not confirmed';
    END IF;
    UPDATE vc.story_event
       SET projection_state = 'USER_DELETED'
     WHERE owner_user_id = p_owner AND id = p_event_id;
    RETURN true;
END;
$$;

-- Deletion cancels in-flight jobs. A story projection is the durable record of
-- a committed world event, so it stays until the account itself is removed.
CREATE OR REPLACE FUNCTION vc.request_account_deletion_current()
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_username text;
    v_inserted boolean := false;
    v_generation record;
    v_generations integer := 0;
    v_work_items integer := 0;
BEGIN
    PERFORM vc.export_pointer_barrier(v_owner);

    SELECT a.username INTO v_username FROM vc.identity_account a
     WHERE a.id = v_owner AND a.status = 'ACTIVE' FOR UPDATE;
    IF v_username IS NULL THEN
        RETURN FALSE;
    END IF;

    INSERT INTO vc.account_deletion_intent(
        account_id, username_digest, status, requested_at, completed_at, poll_until)
    VALUES (v_owner, vc.username_tombstone_digest(v_username),
            'REQUESTED', now(), NULL, now() + interval '5 minutes')
    ON CONFLICT (account_id) DO UPDATE
       SET poll_until = greatest(vc.account_deletion_intent.poll_until,
                                now() + interval '5 minutes')
     WHERE vc.account_deletion_intent.status = 'REQUESTED'
    RETURNING (xmax = 0) INTO v_inserted;

    IF v_inserted THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        VALUES ('ACCOUNT_DELETE_REQUESTED', v_owner, v_username);
    END IF;

    FOR v_generation IN
        SELECT g.id FROM vc.generation g
         WHERE g.owner_user_id = v_owner
           AND g.status IN ('CREATED', 'INPUT_REVIEW', 'QUEUED', 'IN_PROGRESS',
                            'WAITING_FOR_CAPACITY', 'FINAL_REVIEW')
         ORDER BY g.id
         FOR UPDATE
    LOOP
        PERFORM vc.cancel_generation(v_owner, v_generation.id);
        v_generations := v_generations + 1;
    END LOOP;

    UPDATE vc.work_item
       SET status = 'CANCELLED', claim_token = NULL, claim_fence = NULL,
           claimed_at = NULL, lease_expires_at = NULL, finished_at = now()
     WHERE owner_user_id = v_owner
       AND status IN ('PENDING', 'CLAIMED')
       AND kind IS DISTINCT FROM 'STORY_PROJECTION';
    GET DIAGNOSTICS v_work_items = ROW_COUNT;

    UPDATE vc.account_deletion_intent
       SET cancelled_generations = cancelled_generations + v_generations,
           cancelled_work_items = cancelled_work_items + v_work_items
     WHERE account_id = v_owner AND status = 'REQUESTED';
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION vc.commit_story_event(
    bigint, bigint, bigint, text, bigint, text, text, text[], jsonb, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.ensure_story_projection(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.confirm_story_projection(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.record_story_projection_deleted(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.commit_story_event(
        bigint, bigint, bigint, text, bigint, text, text, text[], jsonb, jsonb, text),
    vc.ensure_story_projection(bigint, bigint),
    vc.confirm_story_projection(bigint, bigint),
    vc.record_story_projection_deleted(bigint, bigint)
    TO vc_api, vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint)
    RENAME TO export_v2_owner_metadata_w14_action;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_w14_action(p_owner);
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint),
    vc.export_v2_owner_metadata_w14_action(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_w14_action(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
