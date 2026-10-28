-- W14-T2: action idempotency, version conflicts, illegal statements, and deletion.
-- A replay returns the committed event and does not advance or duplicate clues.
-- A statement that changes items or truth writes nothing. Rules stay in Go.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (23001, 'w14 action owner'),
    (23002, 'w14 action other');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (23001, 'w14-action-owner', 'test-hash', 'USER', 'ACTIVE', 'w14 action owner');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (23001, 23001, 'rainy-inn', true),
    (23002, 23002, 'rainy-inn', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (23001, 23001, 23001, 'story-chat-23001', 'STORY'),
    (23002, 23002, 23002, 'story-chat-23002', 'STORY');

CREATE TEMP TABLE w14_230 (
    run_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    event_id bigint NOT NULL,
    projection_id bigint NOT NULL
);
GRANT SELECT, INSERT ON w14_230 TO vc_api;

BEGIN;
SELECT vc.set_owner_context(23001, 'action', encode(vc.hmac(convert_to('vc-owner-binding-v1|23001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|action', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
    v_event bigint;
    v_version bigint;
    v_proj bigint;
    v_replayed boolean;
    v_event2 bigint;
    v_version2 bigint;
    v_proj2 bigint;
    v_replayed2 boolean;
    v_state jsonb := '{"items":["cabinet_key"],"clues":["loan_note"],"truth":{"keeper":"zhou"},"knowledge":{"player":["loan_note"],"lin":["loan_note"]}}'::jsonb;
BEGIN
    SELECT out_run_id, out_branch_id INTO v_run, v_branch
      FROM vc.create_story_run(23001, 'rainy-inn-v1', 0, 'investigation', 23001);
    PERFORM vc.add_story_participant(23001, v_run, 'player', 'player', 'lobby', NULL);
    PERFORM vc.add_story_participant(23001, v_run, 'lin', 'npc', 'lobby', NULL);
    PERFORM vc.add_story_participant(23001, v_run, 'zhou', 'npc', 'room', NULL);
    PERFORM vc.add_story_participant(23001, v_run, 'su', 'npc', 'workshop', NULL);

    BEGIN
        PERFORM vc.commit_story_event(
            23001, v_run, v_branch, 'bad-statement', 0, 'statement', 'lin',
            ARRAY['player', 'lin'], '{"text":"真相是别人"}'::jsonb,
            '{"items":[],"clues":[],"truth":{"keeper":"lin"},"knowledge":{}}'::jsonb,
            NULL);
        RAISE EXCEPTION 'illegal statement wrote';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story statement cannot change items or truth' THEN RAISE; END IF;
    END;
    IF (SELECT world_version FROM vc.story_run WHERE id = v_run) <> 0
       OR EXISTS (SELECT 1 FROM vc.story_event WHERE run_id = v_run)
       OR EXISTS (SELECT 1 FROM vc.story_branch WHERE run_id = v_run AND parent_branch_id IS NOT NULL) THEN
        RAISE EXCEPTION 'illegal statement changed the world';
    END IF;

    SELECT out_event_id, out_world_version, out_projection_id, out_replayed
      INTO v_event, v_version, v_proj, v_replayed
      FROM vc.commit_story_event(
          23001, v_run, v_branch, 'a1', 0, 'action', 'player',
          ARRAY['player', 'lin'], '{"text":"出示借据"}'::jsonb,
          v_state, 'investigation');
    IF v_replayed OR v_version <> 1 OR v_event IS NULL OR v_proj IS NULL THEN
        RAISE EXCEPTION 'action commit did not advance once';
    END IF;

    SELECT out_event_id, out_world_version, out_projection_id, out_replayed
      INTO v_event2, v_version2, v_proj2, v_replayed2
      FROM vc.commit_story_event(
          23001, v_run, v_branch, 'a1', 0, 'action', 'player',
          ARRAY['player', 'lin'], '{"text":"再出示"}'::jsonb,
          '{"items":["cabinet_key"],"clues":["loan_note","blue_sleeve"],"truth":{"keeper":"zhou"},"knowledge":{}}'::jsonb,
          'investigation');
    IF NOT v_replayed2 OR v_event2 IS DISTINCT FROM v_event
       OR v_version2 IS DISTINCT FROM 1 OR v_proj2 IS DISTINCT FROM v_proj THEN
        RAISE EXCEPTION 'replay changed the committed action';
    END IF;
    IF (SELECT world_version FROM vc.story_run WHERE id = v_run) <> 1
       OR (SELECT count(*) FROM vc.story_event WHERE run_id = v_run AND action_id = 'a1') <> 1
       OR (SELECT world_state->'clues' FROM vc.story_run WHERE id = v_run) <> '["loan_note"]'::jsonb
       OR (SELECT world_state->'items' FROM vc.story_run WHERE id = v_run) <> '["cabinet_key"]'::jsonb
       OR (SELECT world_state->'truth' FROM vc.story_run WHERE id = v_run) <> '{"keeper":"zhou"}'::jsonb THEN
        RAISE EXCEPTION 'replay advanced the version or duplicated a clue';
    END IF;

    BEGIN
        PERFORM vc.commit_story_event(
            23001, v_run, v_branch, 'a-stale', 0, 'action', 'player',
            ARRAY['player'], '{"text":"旧版本"}'::jsonb,
            v_state, 'investigation');
        RAISE EXCEPTION 'stale version wrote';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story commit conflicts with world_version' THEN RAISE; END IF;
    END;
    IF (SELECT count(*) FROM vc.story_event WHERE run_id = v_run) <> 1
       OR (SELECT world_version FROM vc.story_run WHERE id = v_run) <> 1
       OR (SELECT count(*) FROM vc.story_branch WHERE run_id = v_run) <> 1 THEN
        RAISE EXCEPTION 'version conflict wrote a row or a branch';
    END IF;

    SELECT out_world_version, out_replayed
      INTO v_version2, v_replayed2
      FROM vc.commit_story_event(
          23001, v_run, v_branch, 'say-1', 1, 'statement', 'lin',
          ARRAY['player', 'lin'], '{"text":"我没去过维修间"}'::jsonb,
          NULL, NULL);
    IF v_replayed2 OR v_version2 <> 2
       OR (SELECT world_state->'items' FROM vc.story_run WHERE id = v_run) <> '["cabinet_key"]'::jsonb
       OR (SELECT world_state->'truth' FROM vc.story_run WHERE id = v_run) <> '{"keeper":"zhou"}'::jsonb
       OR (SELECT world_state->'clues' FROM vc.story_run WHERE id = v_run) <> '["loan_note"]'::jsonb
       OR (SELECT stage FROM vc.story_run WHERE id = v_run) <> 'investigation' THEN
        RAISE EXCEPTION 'statement changed items, clues, truth, or stage';
    END IF;

    INSERT INTO w14_230(run_id, branch_id, event_id, projection_id)
    VALUES (v_run, v_branch, v_event, v_proj);
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(23001, 'cross', encode(vc.hmac(convert_to('vc-owner-binding-v1|23001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|cross', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
BEGIN
    SELECT run_id, branch_id INTO v_run, v_branch FROM w14_230;
    BEGIN
        PERFORM vc.commit_story_event(
            23002, v_run, v_branch, 'a-cross', 2, 'action', 'player',
            ARRAY['player'], '{}'::jsonb,
            '{"items":[],"clues":[],"truth":{},"knowledge":{}}'::jsonb,
            'investigation');
        RAISE EXCEPTION 'cross owner commit accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(23002, 'other', encode(vc.hmac(convert_to('vc-owner-binding-v1|23002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
BEGIN
    SELECT run_id, branch_id INTO v_run, v_branch FROM w14_230;
    IF (SELECT count(*) FROM vc.story_event) <> 0
       OR (SELECT count(*) FROM vc.story_run) <> 0 THEN
        RAISE EXCEPTION 'other owner read the action run';
    END IF;
    BEGIN
        PERFORM vc.commit_story_event(
            23002, v_run, v_branch, 'a-cross', 2, 'action', 'player',
            ARRAY['player'], '{}'::jsonb,
            '{"items":[],"clues":[],"truth":{},"knowledge":{}}'::jsonb,
            'investigation');
        RAISE EXCEPTION 'cross owner run commit accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'commit_story_event: run not found' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(23001, 'deleting', encode(vc.hmac(convert_to('vc-owner-binding-v1|23001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|deleting', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
    v_events bigint;
BEGIN
    SELECT run_id, branch_id INTO v_run, v_branch FROM w14_230;
    SELECT count(*) INTO v_events FROM vc.story_event WHERE run_id = v_run;
    IF vc.request_account_deletion_current() IS NOT TRUE THEN
        RAISE EXCEPTION 'deletion intent was not requested';
    END IF;
    BEGIN
        PERFORM vc.commit_story_event(
            23001, v_run, v_branch, 'a-during-delete', 2, 'action', 'player',
            ARRAY['player'], '{}'::jsonb,
            '{"items":[],"clues":[],"truth":{},"knowledge":{}}'::jsonb,
            'investigation');
        RAISE EXCEPTION 'commit survived deletion intent';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    IF (SELECT count(*) FROM vc.story_event WHERE run_id = v_run) <> v_events
       OR (SELECT world_version FROM vc.story_run WHERE id = v_run) <> 2
       OR (SELECT count(*) FROM vc.story_branch WHERE run_id = v_run) <> 1 THEN
        RAISE EXCEPTION 'deletion commit wrote a row or a branch';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_run bigint;
    v_event bigint;
    v_proj bigint;
BEGIN
    SELECT run_id, event_id, projection_id INTO v_run, v_event, v_proj FROM w14_230;
    IF (SELECT count(*) FROM vc.work_item
         WHERE owner_user_id = 23001 AND kind = 'STORY_PROJECTION' AND ref_id = v_event) <> 1
       OR (SELECT id FROM vc.work_item
            WHERE owner_user_id = 23001 AND kind = 'STORY_PROJECTION' AND ref_id = v_event) <> v_proj
       OR (SELECT status FROM vc.work_item WHERE owner_user_id = 23001 AND id = v_proj) <> 'PENDING' THEN
        RAISE EXCEPTION 'action projection was duplicated or not pending';
    END IF;
    IF (SELECT count(*) FROM vc.work_item
         WHERE owner_user_id = 23001 AND kind = 'STORY_PROJECTION') <> 2 THEN
        RAISE EXCEPTION 'statement or replay created an extra projection';
    END IF;
    IF (SELECT kind FROM vc.story_event WHERE owner_user_id = 23001 AND id = v_event) <> 'action'
       OR (SELECT count(*) FROM vc.story_event
            WHERE owner_user_id = 23001 AND run_id = v_run AND kind = 'statement') <> 1 THEN
        RAISE EXCEPTION 'committed event kinds drifted';
    END IF;
    IF (SELECT world_state->'clues' FROM vc.story_run WHERE owner_user_id = 23001 AND id = v_run)
           <> '["loan_note"]'::jsonb THEN
        RAISE EXCEPTION 'clues changed after conflict and deletion';
    END IF;
END $$;
