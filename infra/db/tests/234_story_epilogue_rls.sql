-- W14-T2: discarding a shared-play summary writes no memory. Saving writes one
-- pending candidate for the mapped relationship, and only confirmation accepts it.
\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (23401, 'w14 epilogue owner');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (23401, 'w14-epilogue-owner', 'test-hash', 'USER', 'ACTIVE', 'w14 epilogue owner');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (23401, 23411, 'companion-lin', true),
    (23401, 23412, 'companion-other', false),
    (23401, 23413, 'story-discard', false),
    (23401, 23414, 'story-save', false);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, st_chat_identity, st_mode) VALUES
    (23401, 23413, 23413, 'story-chat-23413', 'STORY'),
    (23401, 23414, 23414, 'story-chat-23414', 'STORY');

CREATE TEMP TABLE w14_234 (
    discard_run bigint NOT NULL,
    save_run bigint NOT NULL,
    memory_id bigint
);
GRANT SELECT, INSERT, UPDATE ON w14_234 TO vc_api;

BEGIN;
SELECT vc.set_owner_context(23401, 'epilogue', encode(vc.hmac(convert_to('vc-owner-binding-v1|23401|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|epilogue', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_discard bigint;
    v_save bigint;
    v_branch bigint;
    v_memory bigint;
    v_again bigint;
    v_pending bigint;
    v_accepted bigint;
    v_other bigint;
BEGIN
    SELECT out_run_id INTO v_discard
      FROM vc.create_story_run(23401, 'rainy-inn-v1', 0, 'investigation', 23413);
    PERFORM vc.add_story_participant(23401, v_discard, 'player', 'player', 'lobby', NULL);
    PERFORM vc.add_story_participant(23401, v_discard, 'lin', 'npc', 'lobby', NULL);
    IF vc.mark_story_ending(23401, v_discard, 'resolved') IS NOT TRUE THEN
        RAISE EXCEPTION 'ending was not marked';
    END IF;
    IF vc.decide_story_epilogue(23401, v_discard, 'discard', NULL, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'discard returned a memory';
    END IF;
    IF vc.decide_story_epilogue(23401, v_discard, 'discard', NULL, NULL) IS NOT NULL THEN
        RAISE EXCEPTION 'discard replay returned a memory';
    END IF;
    SELECT count(*) INTO v_pending FROM vc.list_memory(23401, 23411, false);
    SELECT count(*) INTO v_other FROM vc.list_memory(23401, 23412, false);
    IF v_pending <> 0 OR v_other <> 0 THEN
        RAISE EXCEPTION 'discard wrote a memory';
    END IF;

    SELECT out_run_id, out_branch_id INTO v_save, v_branch
      FROM vc.create_story_run(23401, 'rainy-inn-v1', 0, 'investigation', 23414);
    PERFORM vc.add_story_participant(23401, v_save, 'player', 'player', 'lobby', NULL);
    PERFORM vc.add_story_participant(23401, v_save, 'lin', 'npc', 'lobby', NULL);
    PERFORM vc.add_story_participant(23401, v_save, 'zhou', 'npc', 'room', NULL);
    PERFORM vc.map_story_participant(23401, v_save, 'lin', 23411);
    IF vc.mark_story_ending(23401, v_save, 'resolved') IS NOT TRUE THEN
        RAISE EXCEPTION 'save run ending was not marked';
    END IF;
    BEGIN
        PERFORM vc.decide_story_epilogue(
            23401, v_save, 'save', 23412, '我们一起玩过雨夜旅馆这一局');
        RAISE EXCEPTION 'unmapped relationship accepted a summary';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'story epilogue relationship is not mapped on this run' THEN RAISE; END IF;
    END;
    v_memory := vc.decide_story_epilogue(
        23401, v_save, 'save', 23411, '我们一起玩过雨夜旅馆这一局');
    v_again := vc.decide_story_epilogue(
        23401, v_save, 'save', 23411, '我们一起玩过雨夜旅馆这一局');
    IF v_memory IS NULL OR v_again IS DISTINCT FROM v_memory THEN
        RAISE EXCEPTION 'save did not return one stable candidate';
    END IF;
    SELECT count(*) INTO v_pending
      FROM vc.list_memory(23401, 23411, false)
     WHERE out_status = 'PENDING_CONFIRMATION' AND out_id = v_memory
       AND out_summary = '我们一起玩过雨夜旅馆这一局' AND out_scope = 'RELATIONSHIP';
    SELECT count(*) INTO v_accepted
      FROM vc.list_memory(23401, 23411, false)
     WHERE out_status = 'ACCEPTED';
    SELECT count(*) INTO v_other FROM vc.list_memory(23401, 23412, false);
    IF v_pending <> 1 OR v_accepted <> 0 OR v_other <> 0 THEN
        RAISE EXCEPTION 'unconfirmed summary created a canonical memory or a second relationship';
    END IF;
    IF vc.confirm_memory_candidate(23401, v_memory) IS NOT TRUE THEN
        RAISE EXCEPTION 'candidate confirmation failed';
    END IF;
    SELECT count(*) INTO v_accepted
      FROM vc.list_memory(23401, 23411, false)
     WHERE out_status = 'ACCEPTED' AND out_id = v_memory;
    SELECT count(*) INTO v_other FROM vc.list_memory(23401, 23412, false);
    SELECT count(*) INTO v_pending
      FROM vc.list_memory(23401, 23411, false)
     WHERE out_status = 'PENDING_CONFIRMATION';
    IF v_accepted <> 1 OR v_pending <> 0 OR v_other <> 0 THEN
        RAISE EXCEPTION 'confirmation wrote outside the mapped relationship';
    END IF;
    INSERT INTO w14_234(discard_run, save_run, memory_id) VALUES (v_discard, v_save, v_memory);
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(23401, 'export', encode(vc.hmac(convert_to('vc-owner-binding-v1|23401|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|export', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    doc jsonb;
    keys jsonb;
    expected jsonb := '["bindings","capturedAt","consents","evidence","extractionResults","followUps","instances","memoryAutoSave","memoryTimes","proactivePolicies","reminders","sources","sourceTimes","storyRuns","summaries","summarySources","tasks"]'::jsonb;
    v_discard bigint;
    v_save bigint;
    v_memory bigint;
BEGIN
    SELECT discard_run, save_run, memory_id INTO v_discard, v_save, v_memory FROM w14_234;
    doc := vc.export_v2_owner_metadata(23401);
    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO keys FROM jsonb_object_keys(doc) AS k;
    IF keys IS DISTINCT FROM (
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_array_elements_text(expected) AS k
    ) THEN
        RAISE EXCEPTION 'export keys changed: %', keys;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(doc->'storyRuns') run
        WHERE run->>'runId' = v_discard::text
          AND run->>'endingCode' = 'resolved'
          AND run->'epilogue'->>'decision' = 'discard'
          AND run->'epilogue'->'relationshipId' = 'null'::jsonb
          AND run->'epilogue'->'memoryId' = 'null'::jsonb
          AND run->'epilogue'->'summary' = 'null'::jsonb
    ) THEN
        RAISE EXCEPTION 'discard epilogue was exported as a memory';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(doc->'storyRuns') run
        WHERE run->>'runId' = v_save::text
          AND run->>'endingCode' = 'resolved'
          AND run->'endedAt' IS NOT NULL
          AND run->'epilogue'->>'decision' = 'save'
          AND run->'epilogue'->>'relationshipId' = '23411'
          AND run->'epilogue'->>'memoryId' = v_memory::text
          AND run->'epilogue'->>'summary' = '我们一起玩过雨夜旅馆这一局'
          AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(run->'participants') participant
              WHERE participant->>'actorId' = 'lin'
                AND participant->>'relationshipId' = '23411'
          )
    ) THEN
        RAISE EXCEPTION 'save epilogue did not record the mapped relationship';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_memory bigint;
BEGIN
    SELECT memory_id INTO v_memory FROM w14_234;
    IF (SELECT count(*) FROM vc.memory_item WHERE owner_user_id = 23401) <> 1
       OR (SELECT relationship_id FROM vc.memory_item WHERE owner_user_id = 23401 AND id = v_memory) <> 23411
       OR (SELECT status FROM vc.memory_item WHERE owner_user_id = 23401 AND id = v_memory) <> 'ACCEPTED'
       OR (SELECT count(*) FROM vc.story_epilogue WHERE owner_user_id = 23401 AND decision = 'discard') <> 1
       OR (SELECT count(*) FROM vc.story_epilogue WHERE owner_user_id = 23401 AND decision = 'save') <> 1
       OR (SELECT memory_id FROM vc.story_epilogue WHERE owner_user_id = 23401 AND decision = 'save') <> v_memory THEN
        RAISE EXCEPTION 'epilogue memory was not exactly the mapped candidate';
    END IF;
END $$;
