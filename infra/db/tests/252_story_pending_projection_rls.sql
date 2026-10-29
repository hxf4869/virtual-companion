-- W16: pending player-visible projections on the current branch head are readable
-- by that owner only. The read does not confirm, cancel, or otherwise change
-- projection_state. Another owner, a confirmed event, a private-only event,
-- and an event that is no longer on the current head are omitted. Hidden
-- markers are not returned.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (25201, 'w16 projection owner'),
    (25202, 'w16 projection other');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES
    (25201, 'w16-projection-owner', 'test-hash', 'USER', 'ACTIVE', 'w16 projection owner'),
    (25202, 'w16-projection-other', 'test-hash', 'USER', 'ACTIVE', 'w16 projection other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (25201, 25201, 'rainy-inn', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (25201, 25201, 25201, 'story-chat-25201', 'STORY');

CREATE TEMP TABLE w16_252 (
    run_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    confirmed_event bigint NOT NULL,
    pending_event bigint NOT NULL,
    private_event bigint NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON w16_252 TO vc_api;

BEGIN;
SELECT vc.set_owner_context(25201, 'project', encode(vc.hmac(convert_to('vc-owner-binding-v1|25201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|project', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
    v_confirmed bigint;
    v_pending bigint;
    v_private bigint;
    v_n integer;
    v_id bigint;
    v_version bigint;
    v_clue text;
    v_text text;
    v_note text;
    v_qual text;
    v_state1 text;
    v_state2 text;
    v_state jsonb := '{"items":[],"clues":["loan_note"],"truth":{"keeper":"GM_ONLY_WATCH_TRUTH_92"},"knowledge":{},"stage":"investigation"}'::jsonb;
BEGIN
    SELECT out_run_id, out_branch_id INTO v_run, v_branch
      FROM vc.create_story_run(25201, 'rainy-inn-v1', 0, 'investigation', 25201);
    PERFORM vc.add_story_participant(25201, v_run, 'player', 'player', 'lobby', NULL);
    PERFORM vc.add_story_participant(25201, v_run, 'lin', 'npc', 'lobby', NULL);

    SELECT out_event_id INTO v_confirmed
      FROM vc.commit_story_event(
          25201, v_run, v_branch, 'a-confirmed', 0, 'action', 'player',
          ARRAY['player', 'lin'],
          '{"clueName":"已经确认","text":"这句不该再补写","note":"GM_ONLY_WATCH_TRUTH_92"}'::jsonb,
          v_state, 'investigation');
    IF vc.confirm_story_projection(25201, v_confirmed) IS NOT TRUE THEN
        RAISE EXCEPTION 'confirm did not accept the first projection';
    END IF;

    SELECT out_event_id INTO v_pending
      FROM vc.commit_story_event(
          25201, v_run, v_branch, 'a-pending', 1, 'action', 'player',
          ARRAY['player', 'lin'],
          '{"clueName":"钥匙借用记录","text":"出示借据","note":"GM_ONLY_WATCH_TRUTH_92","qualification":"PRIVATE_LIN_LOAN_31"}'::jsonb,
          v_state, 'investigation');
    SELECT out_event_id INTO v_private
      FROM vc.commit_story_event(
          25201, v_run, v_branch, 'a-private', 2, 'action', 'lin',
          ARRAY['lin'],
          '{"text":"PRIVATE_LIN_LOAN_31","note":"GM_ONLY_WATCH_TRUTH_92"}'::jsonb,
          v_state, 'investigation');

    SELECT count(*) INTO v_n FROM vc.list_pending_player_story_projections(25201, v_run);
    IF v_n IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'pending player projections = %', v_n;
    END IF;
    SELECT out_event_id, out_world_version, out_clue_name, out_text, out_note, out_qualification
      INTO v_id, v_version, v_clue, v_text, v_note, v_qual
      FROM vc.list_pending_player_story_projections(25201, v_run);
    IF v_id IS DISTINCT FROM v_pending OR v_version IS DISTINCT FROM 2
       OR v_clue IS DISTINCT FROM '钥匙借用记录' OR v_text IS DISTINCT FROM '出示借据'
       OR v_note IS DISTINCT FROM '' OR v_qual IS DISTINCT FROM '' THEN
        RAISE EXCEPTION 'projection row % % % % % %', v_id, v_version, v_clue, v_text, v_note, v_qual;
    END IF;
    IF position('GM_ONLY_' in v_clue || v_text || v_note || v_qual) > 0
       OR position('PRIVATE_' in v_clue || v_text || v_note || v_qual) > 0
       OR position('keeper' in v_clue || v_text || v_note || v_qual) > 0 THEN
        RAISE EXCEPTION 'projection leaked hidden text';
    END IF;

    SELECT e.projection_state INTO v_state1
      FROM vc.story_event e WHERE e.owner_user_id = 25201 AND e.id = v_confirmed;
    SELECT e.projection_state INTO v_state2
      FROM vc.story_event e WHERE e.owner_user_id = 25201 AND e.id = v_pending;
    IF v_state1 IS DISTINCT FROM 'CONFIRMED' OR v_state2 IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'read changed projection state % %', v_state1, v_state2;
    END IF;

    INSERT INTO w16_252(run_id, branch_id, confirmed_event, pending_event, private_event)
    VALUES (v_run, v_branch, v_confirmed, v_pending, v_private);
END $$;
COMMIT;
RESET ROLE;

-- work_item has no runtime SELECT grant. The table owner checks that the
-- read left the projection job PENDING.
DO $$
DECLARE v_work text;
BEGIN
    SELECT w.status INTO v_work
      FROM vc.work_item w
     WHERE w.owner_user_id = 25201 AND w.kind = 'STORY_PROJECTION'
       AND w.ref_id = (SELECT pending_event FROM w16_252);
    IF v_work IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'read changed work item %', v_work;
    END IF;
END $$;

-- Point the head at a child forked at version 0. The pending event stays
-- PENDING on the old branch and must leave the read.
INSERT INTO vc.story_branch(owner_user_id, id, run_id, parent_branch_id, fork_world_version)
SELECT 25201, nextval('vc.story_branch_id_seq'), run_id, branch_id, 0 FROM w16_252;
UPDATE vc.story_run r
   SET current_branch_id = (
        SELECT b.id FROM vc.story_branch b
         WHERE b.owner_user_id = 25201 AND b.run_id = r.id AND b.fork_world_version = 0
         ORDER BY b.id DESC LIMIT 1)
 WHERE r.owner_user_id = 25201
   AND r.id = (SELECT run_id FROM w16_252);

BEGIN;
SELECT vc.set_owner_context(25201, 'project2', encode(vc.hmac(convert_to('vc-owner-binding-v1|25201|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|project2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_n integer;
    v_state text;
BEGIN
    SELECT count(*) INTO v_n
      FROM vc.list_pending_player_story_projections(25201, (SELECT run_id FROM w16_252));
    IF v_n IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'off-head pending projections = %', v_n;
    END IF;
    SELECT e.projection_state INTO v_state
      FROM vc.story_event e
     WHERE e.owner_user_id = 25201 AND e.id = (SELECT pending_event FROM w16_252);
    IF v_state IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'off-head read changed state %', v_state;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE v_work text;
BEGIN
    SELECT w.status INTO v_work
      FROM vc.work_item w
     WHERE w.owner_user_id = 25201 AND w.kind = 'STORY_PROJECTION'
       AND w.ref_id = (SELECT pending_event FROM w16_252);
    IF v_work IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'off-head read changed work item %', v_work;
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(25202, 'project3', encode(vc.hmac(convert_to('vc-owner-binding-v1|25202|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|project3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM 1 FROM vc.list_pending_player_story_projections(25202, (SELECT run_id FROM w16_252));
    RAISE EXCEPTION 'other owner listed the run';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%other owner listed%' THEN
            RAISE;
        END IF;
END $$;
COMMIT;
RESET ROLE;
