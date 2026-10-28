-- W12-A: story run isolation, STORY-only binding, owner export, and account deletion.
-- Owner 2 cannot read owner 1. Missing owner context returns no rows. A COMPANION
-- chat cannot open a run. Export keeps the existing keys, including the W10
-- inbox and notification keys, and adds this owner's run state. Account
-- deletion removes the rows without a new external receipt.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (17001, 'story owner'),
    (17002, 'story other');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (17001, 'w12-story-owner', 'test-hash', 'USER', 'ACTIVE', 'story owner');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (17001, 17001, 'rainy-inn', true),
    (17001, 17011, 'daily-card', true),
    (17002, 17002, 'rainy-inn', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (17001, 17001, 17001, 'story-chat-17001', 'STORY'),
    (17001, 17011, 17011, 'companion-chat-17001', 'COMPANION'),
    (17002, 17002, 17002, 'story-chat-17002', 'STORY');

CREATE TEMP TABLE w12_story_ids (
    owner_user_id bigint PRIMARY KEY,
    run_id bigint NOT NULL,
    branch_id bigint NOT NULL,
    event_id bigint
);
GRANT SELECT, INSERT ON w12_story_ids TO vc_api;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vc'
          AND c.relname IN ('story_run', 'story_branch', 'story_participant', 'story_event')
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
    ) OR (
        SELECT count(*) FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'vc'
          AND c.relname IN ('story_run', 'story_branch', 'story_participant', 'story_event')
    ) <> 4 THEN
        RAISE EXCEPTION 'story tables missing ENABLE and FORCE ROW LEVEL SECURITY';
    END IF;
    IF (
        SELECT count(*) FROM pg_policies
        WHERE schemaname = 'vc'
          AND tablename IN ('story_run', 'story_branch', 'story_participant', 'story_event')
          AND policyname = 'owner_isolation'
          AND cmd = 'ALL'
          AND roles @> ARRAY['vc_api', 'vc_worker']::name[]
          AND cardinality(roles) = 2
    ) <> 4 THEN
        RAISE EXCEPTION 'story owner_isolation policy does not match memorycore_scope';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'vc'
          AND p.proname IN ('create_story_run', 'add_story_participant', 'append_story_event')
          AND NOT p.prosecdef
    ) OR (
        SELECT count(*) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'vc'
          AND p.proname IN ('create_story_run', 'add_story_participant', 'append_story_event')
          AND p.prosecdef
    ) <> 3 THEN
        RAISE EXCEPTION 'story write functions must be SECURITY DEFINER';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'vc'
          AND table_name = 'account_deletion_intent'
          AND column_name LIKE '%story%'
    ) THEN
        RAISE EXCEPTION 'story deletion must not add an external receipt';
    END IF;
END $$;

BEGIN;
SELECT vc.set_owner_context(17001, 'story', encode(vc.hmac(convert_to('vc-owner-binding-v1|17001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|story', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
    v_event bigint;
BEGIN
    SELECT out_run_id, out_branch_id INTO v_run, v_branch
      FROM vc.create_story_run(17001, 'rainy-inn-v1', 0, 'investigation', 17001);
    IF v_run IS NULL OR v_branch IS NULL THEN
        RAISE EXCEPTION 'story run did not create a root branch';
    END IF;
    PERFORM vc.add_story_participant(17001, v_run, 'lin', 'npc', 'lobby', NULL);
    v_event := vc.append_story_event(
        17001, v_run, v_branch, 'lin', ARRAY['player', 'lin'], 0,
        '{"kind":"statement","text":"我在大堂"}'::jsonb);
    INSERT INTO w12_story_ids(owner_user_id, run_id, branch_id, event_id)
    VALUES (17001, v_run, v_branch, v_event);

    BEGIN
        PERFORM vc.create_story_run(17001, 'rainy-inn-v1', 0, 'investigation', 17011);
        RAISE EXCEPTION 'COMPANION chat created a story run';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story run requires a STORY conversation' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_story_run(17002, 'rainy-inn-v1', 0, 'investigation', 17002);
        RAISE EXCEPTION 'cross owner create accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
    BEGIN
        INSERT INTO vc.story_run(owner_user_id, id, case_id, world_version, stage, conversation_id)
        VALUES (17001, 1, 'rainy-inn-v1', 0, 'investigation', 17001);
        RAISE EXCEPTION 'direct story insert accepted';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(17002, 'other', encode(vc.hmac(convert_to('vc-owner-binding-v1|17002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
BEGIN
    IF (SELECT count(*) FROM vc.story_run) <> 0
       OR (SELECT count(*) FROM vc.story_branch) <> 0
       OR (SELECT count(*) FROM vc.story_participant) <> 0
       OR (SELECT count(*) FROM vc.story_event) <> 0 THEN
        RAISE EXCEPTION 'owner 2 read owner 1 story rows';
    END IF;
    SELECT out_run_id, out_branch_id INTO v_run, v_branch
      FROM vc.create_story_run(17002, 'rainy-inn-v1', 0, 'investigation', 17002);
    INSERT INTO w12_story_ids(owner_user_id, run_id, branch_id)
    VALUES (17002, v_run, v_branch);
    IF (SELECT count(*) FROM vc.story_run) <> 1
       OR (SELECT count(*) FROM vc.story_branch) <> 1
       OR EXISTS (SELECT 1 FROM vc.story_run WHERE owner_user_id <> 17002)
       OR EXISTS (SELECT 1 FROM vc.story_branch WHERE owner_user_id <> 17002)
       OR (SELECT count(*) FROM vc.story_participant) <> 0
       OR (SELECT count(*) FROM vc.story_event) <> 0 THEN
        RAISE EXCEPTION 'owner 2 saw another owner after creating a run';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.story_run) <> 0
       OR (SELECT count(*) FROM vc.story_branch) <> 0
       OR (SELECT count(*) FROM vc.story_participant) <> 0
       OR (SELECT count(*) FROM vc.story_event) <> 0 THEN
        RAISE EXCEPTION 'missing owner context returned story rows';
    END IF;
    BEGIN
        PERFORM vc.export_v2_owner_metadata(17001);
        RAISE EXCEPTION 'export without owner context returned';
    EXCEPTION WHEN raise_exception THEN NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(17001, 'export', encode(vc.hmac(convert_to('vc-owner-binding-v1|17001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|export', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    doc jsonb;
    keys jsonb;
    expected jsonb := '["bindings","capturedAt","consents","evidence","extractionResults","followUps","inbox","instances","memoryAutoSave","memoryTimes","notificationChannels","notificationDeliveries","proactivePolicies","reminders","sources","sourceTimes","storyRuns","summaries","summarySources","tasks"]'::jsonb;
BEGIN
    doc := vc.export_v2_owner_metadata(17001);
    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO keys FROM jsonb_object_keys(doc) AS k;
    IF keys IS DISTINCT FROM (
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_array_elements_text(expected) AS k
    ) THEN
        RAISE EXCEPTION 'export keys changed: %', keys;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(doc->'storyRuns') run
        WHERE run->>'caseId' = 'rainy-inn-v1'
          AND run->>'conversationId' = '17001'
          AND run->>'stage' = 'investigation'
          AND run->>'worldVersion' = '0'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(run->'branches') branch
              WHERE branch->'parentBranchId' = 'null'::jsonb
                AND branch->'forkWorldVersion' = 'null'::jsonb
          )
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(run->'participants') participant
              WHERE participant->>'actorId' = 'lin'
                AND participant->>'role' = 'npc'
                AND participant->>'scene' = 'lobby'
                AND participant->'relationshipId' = 'null'::jsonb
          )
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(run->'events') event
              WHERE event->>'actorId' = 'lin'
                AND event->'visibility' = '["player","lin"]'::jsonb
                AND event->>'worldVersion' = '0'
                AND event->'body' = '{"kind":"statement","text":"我在大堂"}'::jsonb
          )
    ) OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(doc->'storyRuns') run
        WHERE run->>'conversationId' = '17002'
    ) THEN
        RAISE EXCEPTION 'export omitted this owner run or leaked another owner';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(17002, 'export-other', encode(vc.hmac(convert_to('vc-owner-binding-v1|17002|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|export-other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE doc jsonb;
BEGIN
    doc := vc.export_v2_owner_metadata(17002);
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(doc->'storyRuns') run
        WHERE run->>'conversationId' = '17001'
    ) OR NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(doc->'storyRuns') run
        WHERE run->>'conversationId' = '17002'
    ) THEN
        RAISE EXCEPTION 'other owner export leaked or dropped its run';
    END IF;
    BEGIN
        PERFORM vc.export_v2_owner_metadata(17001);
        RAISE EXCEPTION 'cross owner export accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(17001, 'delete', encode(vc.hmac(convert_to('vc-owner-binding-v1|17001|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|delete', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_run bigint;
    v_branch bigint;
BEGIN
    SELECT run_id, branch_id INTO v_run, v_branch FROM w12_story_ids WHERE owner_user_id = 17001;
    IF vc.request_account_deletion_current() IS NOT TRUE THEN
        RAISE EXCEPTION 'deletion intent was not requested';
    END IF;
    BEGIN
        PERFORM vc.append_story_event(
            17001, v_run, v_branch, 'lin', ARRAY['lin'], 0, '{"kind":"statement"}'::jsonb);
        RAISE EXCEPTION 'story write survived deletion intent';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'owner deletion is in progress' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.identity_account_delete_current();
        RAISE EXCEPTION 'account delete skipped the existing ST cleanup barrier';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'ST account cleanup is pending' THEN RAISE; END IF;
    END;
    PERFORM vc.require_st_account_deletion_current();
    PERFORM vc.complete_st_account_deletion_current('story-cleanup-17001');
    IF vc.identity_account_delete_current() IS NOT TRUE THEN
        RAISE EXCEPTION 'account delete did not remove the owner';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.vc_user WHERE id = 17001)
       OR EXISTS (SELECT 1 FROM vc.story_run WHERE owner_user_id = 17001)
       OR EXISTS (SELECT 1 FROM vc.story_branch WHERE owner_user_id = 17001)
       OR EXISTS (SELECT 1 FROM vc.story_participant WHERE owner_user_id = 17001)
       OR EXISTS (SELECT 1 FROM vc.story_event WHERE owner_user_id = 17001) THEN
        RAISE EXCEPTION 'story rows survived account deletion';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.vc_user WHERE id = 17002)
       OR NOT EXISTS (SELECT 1 FROM vc.story_run WHERE owner_user_id = 17002)
       OR NOT EXISTS (SELECT 1 FROM vc.story_branch WHERE owner_user_id = 17002) THEN
        RAISE EXCEPTION 'other owner story rows were deleted';
    END IF;
    IF (SELECT status FROM vc.account_deletion_intent WHERE account_id = 17001) IS DISTINCT FROM 'COMPLETED' THEN
        RAISE EXCEPTION 'existing deletion tombstone was not completed';
    END IF;
END $$;
