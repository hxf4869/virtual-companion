-- W14-T2: one projection per world event. Rewind cancels incomplete work.
-- A confirmed projection the user deleted is not put back to pending.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (23101, 'w14 projection owner');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (23101, 'w14-projection-owner', 'test-hash', 'USER', 'ACTIVE', 'w14 projection owner');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (23101, 23101, 'rainy-inn', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (23101, 23101, 23101, 'story-chat-23101', 'STORY');

CREATE TEMP TABLE w14_231 (
    run_id bigint NOT NULL,
    old_branch_id bigint NOT NULL,
    event1 bigint NOT NULL,
    proj1 bigint NOT NULL,
    event2 bigint NOT NULL,
    proj2 bigint NOT NULL
);
GRANT SELECT, INSERT ON w14_231 TO vc_api;

BEGIN;
SELECT vc.set_owner_context(23101, 'project', encode(vc.hmac(convert_to('vc-owner-binding-v1|23101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|project', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
    v_event1 bigint;
    v_proj1 bigint;
    v_event2 bigint;
    v_proj2 bigint;
    v_again bigint;
    v_state1 jsonb := '{"items":["cabinet_key"],"clues":["loan_note"],"truth":{"keeper":"zhou"},"knowledge":{"player":["loan_note"]}}'::jsonb;
    v_state2 jsonb := '{"items":["cabinet_key","watch"],"clues":["loan_note","blue_sleeve"],"truth":{"keeper":"zhou","place":"cabinet"},"knowledge":{"player":["loan_note","blue_sleeve"]}}'::jsonb;
BEGIN
    SELECT out_run_id, out_branch_id INTO v_run, v_branch
      FROM vc.create_story_run(23101, 'rainy-inn-v1', 0, 'investigation', 23101);
    PERFORM vc.add_story_participant(23101, v_run, 'player', 'player', 'lobby', NULL);
    PERFORM vc.add_story_participant(23101, v_run, 'lin', 'npc', 'lobby', NULL);

    SELECT out_event_id, out_projection_id INTO v_event1, v_proj1
      FROM vc.commit_story_event(
          23101, v_run, v_branch, 'a1', 0, 'action', 'player',
          ARRAY['player', 'lin'], '{"text":"出示借据"}'::jsonb, v_state1, 'investigation');
    SELECT out_event_id, out_projection_id INTO v_event2, v_proj2
      FROM vc.commit_story_event(
          23101, v_run, v_branch, 'a2', 1, 'action', 'player',
          ARRAY['player'], '{"text":"打开柜子"}'::jsonb, v_state2, 'suspicion');

    SELECT out_projection_id INTO v_again
      FROM vc.commit_story_event(
          23101, v_run, v_branch, 'a2', 1, 'action', 'player',
          ARRAY['player'], '{"text":"再打开"}'::jsonb, v_state2, 'suspicion');
    IF v_again IS DISTINCT FROM v_proj2 THEN
        RAISE EXCEPTION 'replay allocated a second projection';
    END IF;
    IF vc.ensure_story_projection(23101, v_event2) IS DISTINCT FROM v_proj2 THEN
        RAISE EXCEPTION 'ensure allocated a second projection';
    END IF;
    IF vc.confirm_story_projection(23101, v_event1) IS NOT TRUE THEN
        RAISE EXCEPTION 'confirm did not accept the pending projection';
    END IF;

    INSERT INTO w14_231(run_id, old_branch_id, event1, proj1, event2, proj2)
    VALUES (v_run, v_branch, v_event1, v_proj1, v_event2, v_proj2);
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.work_item
   SET status = 'CLAIMED', claim_token = 'projection-claim', claim_fence = 'projection-fence'
 WHERE owner_user_id = 23101
   AND id = (SELECT proj2 FROM w14_231)
   AND status = 'PENDING';

DO $$
BEGIN
    IF (SELECT status FROM vc.work_item WHERE owner_user_id = 23101 AND id = (SELECT proj2 FROM w14_231))
           <> 'CLAIMED'
       OR (SELECT status FROM vc.work_item WHERE owner_user_id = 23101 AND id = (SELECT proj1 FROM w14_231))
           <> 'DONE'
       OR (SELECT count(*) FROM vc.work_item
            WHERE owner_user_id = 23101 AND kind = 'STORY_PROJECTION') <> 2 THEN
        RAISE EXCEPTION 'projection statuses were not one confirmed and one claimed';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(23101, 'rewind', encode(vc.hmac(convert_to('vc-owner-binding-v1|23101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|rewind', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_event1 bigint;
    v_event2 bigint;
    v_proj1 bigint;
    v_proj2 bigint;
    v_kept bigint;
BEGIN
    SELECT run_id, event1, event2, proj1, proj2
      INTO v_run, v_event1, v_event2, v_proj1, v_proj2
      FROM w14_231;
    PERFORM vc.rewind_story(23101, v_run, 1, 'rewind-chat-23101');
    IF vc.record_story_projection_deleted(23101, v_event1) IS NOT TRUE THEN
        RAISE EXCEPTION 'confirmed projection was not marked deleted';
    END IF;
    IF vc.ensure_story_projection(23101, v_event1) IS DISTINCT FROM v_proj1
       OR vc.ensure_story_projection(23101, v_event1) IS DISTINCT FROM v_proj1 THEN
        RAISE EXCEPTION 'ensure rewrote the deleted projection';
    END IF;
    IF vc.confirm_story_projection(23101, v_event1) IS NOT FALSE THEN
        RAISE EXCEPTION 'confirm reopened a user-deleted projection';
    END IF;
    v_kept := vc.ensure_story_projection(23101, v_event2);
    IF v_kept IS DISTINCT FROM v_proj2 THEN
        RAISE EXCEPTION 'ensure reopened a cancelled projection';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_event1 bigint;
    v_event2 bigint;
    v_proj1 bigint;
    v_proj2 bigint;
BEGIN
    SELECT event1, event2, proj1, proj2 INTO v_event1, v_event2, v_proj1, v_proj2 FROM w14_231;
    IF (SELECT projection_state FROM vc.story_event WHERE owner_user_id = 23101 AND id = v_event1)
           <> 'USER_DELETED'
       OR (SELECT status FROM vc.work_item WHERE owner_user_id = 23101 AND id = v_proj1) <> 'DONE'
       OR (SELECT projection_state FROM vc.story_event WHERE owner_user_id = 23101 AND id = v_event2)
           <> 'CANCELLED'
       OR (SELECT status FROM vc.work_item WHERE owner_user_id = 23101 AND id = v_proj2) <> 'CANCELLED' THEN
        RAISE EXCEPTION 'projection lifecycle did not stick';
    END IF;
    IF (SELECT count(*) FROM vc.work_item
         WHERE owner_user_id = 23101 AND kind = 'STORY_PROJECTION' AND ref_id = v_event1) <> 1
       OR (SELECT count(*) FROM vc.work_item
            WHERE owner_user_id = 23101 AND kind = 'STORY_PROJECTION' AND ref_id = v_event2) <> 1
       OR EXISTS (
            SELECT 1 FROM vc.work_item
             WHERE owner_user_id = 23101 AND kind = 'STORY_PROJECTION' AND status = 'PENDING'
       ) THEN
        RAISE EXCEPTION 'a projection was duplicated or returned to pending';
    END IF;
END $$;
