-- W14-T2: rewind restores the prefix. A late commit on the old head conflicts
-- and does not write the current world or insert a branch.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (23201, 'w14 rewind owner');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (23201, 'w14-rewind-owner', 'test-hash', 'USER', 'ACTIVE', 'w14 rewind owner');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (23201, 23201, 'rainy-inn', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (23201, 23201, 23201, 'story-chat-23201', 'STORY');

CREATE TEMP TABLE w14_232 (
    run_id bigint NOT NULL,
    old_branch_id bigint NOT NULL,
    new_branch_id bigint NOT NULL
);
GRANT SELECT, INSERT ON w14_232 TO vc_api;

BEGIN;
SELECT vc.set_owner_context(23201, 'rewind', encode(vc.hmac(convert_to('vc-owner-binding-v1|23201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|rewind', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_old bigint;
    v_new bigint;
    v_version bigint;
    v_branches bigint;
    v_state jsonb;
    v_kept bigint;
    v_mapped boolean;
    v_branch_chat text;
    v_conv_chat text;
    v_state1 jsonb := '{"items":["cabinet_key"],"clues":["loan_note"],"truth":{"keeper":"zhou"},"knowledge":{"player":["loan_note"],"lin":["loan_note"]}}'::jsonb;
    v_state2 jsonb := '{"items":["cabinet_key","watch"],"clues":["loan_note","blue_sleeve"],"truth":{"keeper":"zhou","place":"cabinet"},"knowledge":{"player":["loan_note","blue_sleeve"]}}'::jsonb;
    v_state3 jsonb := '{"items":["cabinet_key"],"clues":["loan_note"],"truth":{"keeper":"zhou"},"knowledge":{"player":["loan_note"],"lin":["loan_note"]}}'::jsonb;
BEGIN
    SELECT out_run_id, out_branch_id INTO v_run, v_old
      FROM vc.create_story_run(23201, 'rainy-inn-v1', 0, 'investigation', 23201);
    PERFORM vc.add_story_participant(23201, v_run, 'player', 'player', 'lobby', NULL);
    PERFORM vc.add_story_participant(23201, v_run, 'lin', 'npc', 'lobby', NULL);
    IF (SELECT st_chat_identity FROM vc.story_branch WHERE owner_user_id = 23201 AND id = v_old) IS NOT NULL THEN
        RAISE EXCEPTION 'root branch inferred a chat identity';
    END IF;
    -- SQL does not evaluate AND/OR operands in source order, so the mapping
    -- must finish before the reads. The three checks stay the same.
    v_mapped := vc.map_story_branch_chat(23201, v_old, 'explicit-chat-23201');
    SELECT st_chat_identity INTO v_branch_chat
      FROM vc.story_branch WHERE owner_user_id = 23201 AND id = v_old;
    SELECT st_chat_identity INTO v_conv_chat
      FROM vc.conversation WHERE owner_user_id = 23201 AND id = 23201;
    IF v_mapped IS NOT TRUE
       OR v_branch_chat IS DISTINCT FROM 'explicit-chat-23201'
       OR v_conv_chat IS DISTINCT FROM 'story-chat-23201' THEN
        RAISE EXCEPTION 'branch chat identity was not stored explicitly';
    END IF;

    PERFORM vc.commit_story_event(
        23201, v_run, v_old, 'a1', 0, 'action', 'player',
        ARRAY['player', 'lin'], '{"text":"出示借据"}'::jsonb, v_state1, 'investigation');
    PERFORM vc.commit_story_event(
        23201, v_run, v_old, 'a2', 1, 'action', 'player',
        ARRAY['player'], '{"text":"打开柜子"}'::jsonb, v_state2, 'suspicion');

    SELECT out_branch_id, out_world_version INTO v_new, v_version
      FROM vc.rewind_story(23201, v_run, 1, 'rewind-chat-23201');
    IF v_version <> 1 OR v_new IS NULL OR v_new = v_old THEN
        RAISE EXCEPTION 'rewind did not move the current head';
    END IF;
    SELECT world_state INTO v_state FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run;
    IF v_state IS DISTINCT FROM (
           SELECT state_after FROM vc.story_event
            WHERE owner_user_id = 23201 AND run_id = v_run AND action_id = 'a1')
       OR v_state->'clues' <> '["loan_note"]'::jsonb
       OR v_state->'items' <> '["cabinet_key"]'::jsonb
       OR v_state->'truth' <> '{"keeper":"zhou"}'::jsonb
       OR (SELECT stage FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run) <> 'investigation'
       OR (SELECT current_branch_id FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run) <> v_new
       OR (SELECT parent_branch_id FROM vc.story_branch WHERE owner_user_id = 23201 AND id = v_new) <> v_old
       OR (SELECT fork_world_version FROM vc.story_branch WHERE owner_user_id = 23201 AND id = v_new) <> 1
       OR (SELECT st_chat_identity FROM vc.story_branch WHERE owner_user_id = 23201 AND id = v_new)
              IS DISTINCT FROM 'rewind-chat-23201'
       OR (SELECT st_chat_identity FROM vc.story_branch WHERE owner_user_id = 23201 AND id = v_old)
              IS DISTINCT FROM 'explicit-chat-23201' THEN
        RAISE EXCEPTION 'rewind did not restore the prefix or the explicit chats';
    END IF;
    IF (SELECT count(*) FROM vc.list_story_branch_events(23201, v_new) WHERE out_action_id = 'a1') <> 1
       OR (SELECT count(*) FROM vc.list_story_branch_events(23201, v_new) WHERE out_action_id = 'a2') <> 0
       OR (SELECT count(*) FROM vc.story_event WHERE owner_user_id = 23201 AND run_id = v_run AND action_id = 'a2') <> 1 THEN
        RAISE EXCEPTION 'prefix read mixed in or dropped the future event';
    END IF;

    SELECT count(*) INTO v_branches FROM vc.story_branch WHERE owner_user_id = 23201 AND run_id = v_run;
    BEGIN
        PERFORM vc.commit_story_event(
            23201, v_run, v_old, 'a-late', 1, 'action', 'player',
            ARRAY['player'], '{"text":"迟到"}'::jsonb, v_state2, 'suspicion');
        RAISE EXCEPTION 'late commit wrote the current world';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story commit conflicts with the current branch' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.append_story_event(
            23201, v_run, v_old, 'player', ARRAY['player'], 1, '{"text":"迟到陈述"}'::jsonb);
        RAISE EXCEPTION 'late append wrote the current world';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story commit conflicts with the current branch' THEN RAISE; END IF;
    END;
    IF (SELECT count(*) FROM vc.story_branch WHERE owner_user_id = 23201 AND run_id = v_run) <> v_branches
       OR (SELECT world_version FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run) <> 1
       OR (SELECT world_state FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run) IS DISTINCT FROM v_state
       OR EXISTS (SELECT 1 FROM vc.story_event WHERE owner_user_id = 23201 AND run_id = v_run AND action_id = 'a-late')
       OR (SELECT current_branch_id FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run) <> v_new THEN
        RAISE EXCEPTION 'late request wrote the current world or a new branch';
    END IF;

    SELECT out_world_version INTO v_version
      FROM vc.commit_story_event(
          23201, v_run, v_new, 'a3', 1, 'action', 'player',
          ARRAY['player', 'lin'], '{"text":"沿前缀继续"}'::jsonb, v_state3, 'investigation');
    IF v_version <> 2
       OR (SELECT world_state->'clues' FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run)
              <> '["loan_note"]'::jsonb
       OR (SELECT count(*) FROM vc.list_story_branch_events(23201, v_new) WHERE out_action_id = 'a2') <> 0
       OR (SELECT count(*) FROM vc.list_story_branch_events(23201, v_new) WHERE out_action_id IN ('a1', 'a3')) <> 2
       OR (SELECT count(*) FROM vc.story_branch WHERE owner_user_id = 23201 AND run_id = v_run) <> v_branches THEN
        RAISE EXCEPTION 'the new head did not continue from the prefix';
    END IF;
    SELECT count(*) INTO v_kept FROM vc.story_event
     WHERE owner_user_id = 23201 AND run_id = v_run AND branch_id = v_new;
    IF v_kept <> 1 THEN
        RAISE EXCEPTION 'the continued action was not stored on the new head';
    END IF;

    INSERT INTO w14_232(run_id, old_branch_id, new_branch_id) VALUES (v_run, v_old, v_new);
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_run bigint;
    v_old bigint;
    v_new bigint;
BEGIN
    SELECT run_id, old_branch_id, new_branch_id INTO v_run, v_old, v_new FROM w14_232;
    IF (SELECT count(*) FROM vc.story_branch WHERE owner_user_id = 23201 AND run_id = v_run) <> 2
       OR (SELECT current_branch_id FROM vc.story_run WHERE owner_user_id = 23201 AND id = v_run) <> v_new
       OR EXISTS (
            SELECT 1 FROM vc.story_event
             WHERE owner_user_id = 23201 AND run_id = v_run AND branch_id = v_new AND action_id = 'a2'
       ) THEN
        RAISE EXCEPTION 'rewind left the future event on the current head';
    END IF;
    IF (SELECT projection_state FROM vc.story_event
         WHERE owner_user_id = 23201 AND run_id = v_run AND action_id = 'a2') <> 'CANCELLED' THEN
        RAISE EXCEPTION 'rewind left the future projection pending';
    END IF;
END $$;
