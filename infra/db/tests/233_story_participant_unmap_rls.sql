-- W14-T2: deleting a mapped companion clears relationship_id only.
-- Account deletion still removes every story row. Another owner's relationship
-- cannot be mapped, and the deletion barrier stays closed for every other write.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (23301, 'w14 unmap owner'),
    (23302, 'w14 unmap other');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES
    (23301, 'w14-unmap-owner', 'test-hash', 'USER', 'ACTIVE', 'w14 unmap owner'),
    (23302, 'w14-unmap-other', 'test-hash', 'USER', 'ACTIVE', 'w14 unmap other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (23301, 23311, 'story-host', true),
    (23301, 23312, 'companion-lin', false),
    (23301, 23313, 'companion-zhou', false),
    (23301, 23314, 'companion-lin-again', false),
    (23302, 23321, 'companion-other', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (23301, 23311, 23311, 'story-chat-23301', 'STORY'),
    (23302, 23321, 23321, 'story-chat-23302', 'STORY');

CREATE TEMP TABLE w14_233 (
    run_id bigint NOT NULL,
    lin_id bigint NOT NULL,
    other_run_id bigint NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON w14_233 TO vc_api;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'story_participant_relationship_fk'
          AND pg_get_constraintdef(oid) ILIKE '%ON DELETE SET NULL%'
    ) THEN
        RAISE EXCEPTION 'participant relationship foreign key is not ON DELETE SET NULL';
    END IF;
    IF NOT EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_proc p ON p.oid = t.tgfoid
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'vc'
           AND c.relname = 'story_participant'
           AND NOT t.tgisinternal
           AND p.proname = 'block_story_participant_outbound_rows'
    ) THEN
        RAISE EXCEPTION 'participant deletion guard was not narrowed';
    END IF;
    IF EXISTS (
        SELECT 1
          FROM pg_trigger t
          JOIN pg_proc p ON p.oid = t.tgfoid
          JOIN pg_class c ON c.oid = t.tgrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'vc'
           AND c.relname IN ('story_run', 'story_branch', 'story_event', 'work_item', 'memory_item')
           AND NOT t.tgisinternal
           AND t.tgname LIKE '%deletion_intent%'
           AND p.proname IS DISTINCT FROM 'block_deleting_owner_outbound_rows'
    ) THEN
        RAISE EXCEPTION 'deletion barrier was widened beyond the participant unmap';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(23302, 'other', encode(vc.hmac(convert_to('vc-owner-binding-v1|23302|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
BEGIN
    SELECT out_run_id INTO v_run
      FROM vc.create_story_run(23302, 'rainy-inn-v1', 0, 'investigation', 23321);
    INSERT INTO w14_233(run_id, lin_id, other_run_id) VALUES (0, 0, v_run);
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(23301, 'map', encode(vc.hmac(convert_to('vc-owner-binding-v1|23301|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|map', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_lin bigint;
    v_other bigint;
BEGIN
    SELECT other_run_id INTO v_other FROM w14_233;
    SELECT out_run_id INTO v_run
      FROM vc.create_story_run(23301, 'rainy-inn-v1', 0, 'investigation', 23311);
    PERFORM vc.add_story_participant(23301, v_run, 'player', 'player', 'lobby', NULL);
    v_lin := vc.add_story_participant(23301, v_run, 'lin', 'npc', 'lobby', NULL);
    PERFORM vc.add_story_participant(23301, v_run, 'zhou', 'npc', 'room', NULL);
    PERFORM vc.add_story_participant(23301, v_run, 'su', 'npc', 'workshop', NULL);

    IF vc.map_story_participant(23301, v_run, 'lin', 23312) IS DISTINCT FROM v_lin
       OR (SELECT relationship_id FROM vc.story_participant WHERE owner_user_id = 23301 AND id = v_lin) <> 23312 THEN
        RAISE EXCEPTION 'lin was not mapped to the owned companion';
    END IF;
    BEGIN
        PERFORM vc.map_story_participant(23301, v_run, 'player', 23313);
        RAISE EXCEPTION 'player was mapped as a companion';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story participant actor cannot enter as a companion' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.map_story_participant(23301, v_run, 'ghost', 23313);
        RAISE EXCEPTION 'unknown actor was mapped';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'map_story_participant: actor is not in this run' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.map_story_participant(23301, v_run, 'zhou', 23321);
        RAISE EXCEPTION 'another owner relationship was mapped';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story participant relationship is not owned' THEN RAISE; END IF;
    END;
    IF (SELECT relationship_id FROM vc.story_participant WHERE owner_user_id = 23301 AND id = v_lin) <> 23312
       OR EXISTS (
            SELECT 1 FROM vc.story_participant
             WHERE owner_user_id = 23301 AND run_id = v_run AND actor_id = 'zhou' AND relationship_id IS NOT NULL
       )
       OR (SELECT count(*) FROM vc.story_participant WHERE owner_user_id = 23301 AND run_id = v_run) <> 4 THEN
        RAISE EXCEPTION 'rejected mapping wrote a participant';
    END IF;
    IF vc.delete_relationship(23301, 23312, false) IS NOT TRUE THEN
        RAISE EXCEPTION 'companion delete did not remove the relationship';
    END IF;
    IF (SELECT relationship_id FROM vc.story_participant WHERE owner_user_id = 23301 AND id = v_lin) IS NOT NULL
       OR (SELECT count(*) FROM vc.story_participant WHERE owner_user_id = 23301 AND run_id = v_run) <> 4
       OR NOT EXISTS (SELECT 1 FROM vc.story_run WHERE owner_user_id = 23301 AND id = v_run)
       OR NOT EXISTS (SELECT 1 FROM vc.relationship WHERE owner_user_id = 23301 AND id = 23311) THEN
        RAISE EXCEPTION 'companion delete removed the participant or the story run';
    END IF;
    IF vc.map_story_participant(23301, v_run, 'zhou', 23313) IS NULL
       OR vc.map_story_participant(23301, v_run, 'lin', 23314) IS DISTINCT FROM v_lin THEN
        RAISE EXCEPTION 'lin could not be mapped again';
    END IF;
    UPDATE w14_233 SET run_id = v_run, lin_id = v_lin WHERE other_run_id = v_other;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(23301, 'intent', encode(vc.hmac(convert_to('vc-owner-binding-v1|23301|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|intent', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
BEGIN
    SELECT run_id INTO v_run FROM w14_233;
    IF vc.request_account_deletion_current() IS NOT TRUE THEN
        RAISE EXCEPTION 'deletion intent was not requested';
    END IF;
    BEGIN
        PERFORM vc.map_story_participant(23301, v_run, 'su', 23313);
        RAISE EXCEPTION 'mapping survived deletion intent';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.add_story_participant(23301, v_run, 'extra', 'npc', 'lobby', NULL);
        RAISE EXCEPTION 'participant insert survived deletion intent';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_run bigint;
    v_lin bigint;
BEGIN
    SELECT run_id, lin_id INTO v_run, v_lin FROM w14_233;
    BEGIN
        UPDATE vc.story_participant
           SET scene = 'kitchen'
         WHERE owner_user_id = 23301 AND id = v_lin;
        RAISE EXCEPTION 'scene update survived deletion intent';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    BEGIN
        UPDATE vc.story_participant
           SET relationship_id = NULL, scene = 'kitchen'
         WHERE owner_user_id = 23301 AND id = v_lin;
        RAISE EXCEPTION 'mixed update survived deletion intent';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    UPDATE vc.story_participant
       SET relationship_id = NULL
     WHERE owner_user_id = 23301 AND run_id = v_run AND actor_id = 'zhou'
       AND relationship_id IS NOT NULL;
    IF (SELECT relationship_id FROM vc.story_participant
         WHERE owner_user_id = 23301 AND run_id = v_run AND actor_id = 'zhou') IS NOT NULL
       OR (SELECT scene FROM vc.story_participant
            WHERE owner_user_id = 23301 AND run_id = v_run AND actor_id = 'zhou') <> 'room'
       OR (SELECT relationship_id FROM vc.story_participant WHERE owner_user_id = 23301 AND id = v_lin) <> 23314
       OR (SELECT scene FROM vc.story_participant WHERE owner_user_id = 23301 AND id = v_lin) <> 'lobby' THEN
        RAISE EXCEPTION 'unmap-only update during deletion changed more than relationship_id';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(23301, 'delete', encode(vc.hmac(convert_to('vc-owner-binding-v1|23301|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|delete', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.identity_account_delete_current();
        RAISE EXCEPTION 'account delete skipped the existing ST cleanup barrier';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'ST account cleanup is pending' THEN RAISE; END IF;
    END;
    PERFORM vc.require_st_account_deletion_current();
    PERFORM vc.complete_st_account_deletion_current('story-cleanup-23301');
    IF vc.identity_account_delete_current() IS NOT TRUE THEN
        RAISE EXCEPTION 'account delete did not remove the owner';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_other bigint;
BEGIN
    SELECT other_run_id INTO v_other FROM w14_233;
    IF EXISTS (SELECT 1 FROM vc.vc_user WHERE id = 23301)
       OR EXISTS (SELECT 1 FROM vc.story_run WHERE owner_user_id = 23301)
       OR EXISTS (SELECT 1 FROM vc.story_branch WHERE owner_user_id = 23301)
       OR EXISTS (SELECT 1 FROM vc.story_participant WHERE owner_user_id = 23301)
       OR EXISTS (SELECT 1 FROM vc.story_event WHERE owner_user_id = 23301)
       OR EXISTS (SELECT 1 FROM vc.story_epilogue WHERE owner_user_id = 23301)
       OR EXISTS (SELECT 1 FROM vc.work_item WHERE owner_user_id = 23301 AND kind = 'STORY_PROJECTION') THEN
        RAISE EXCEPTION 'story rows survived account deletion';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.vc_user WHERE id = 23302)
       OR NOT EXISTS (SELECT 1 FROM vc.story_run WHERE owner_user_id = 23302 AND id = v_other)
       OR NOT EXISTS (SELECT 1 FROM vc.relationship WHERE owner_user_id = 23302 AND id = 23321) THEN
        RAISE EXCEPTION 'the other owner was deleted with the unmapped account';
    END IF;
END $$;
