-- 177_st_persisted_sources: V142 acceptance for the ST persisted-source
-- index and its recall/evidence guards. Complements the client and bridge
-- tests with the durable side: trusted-owner enforcement and RLS isolation,
-- initial ingestion, same-revision idempotency, evidence/summary invalidation
-- on a new revision, RETRY without rollback on a stale requested revision,
-- transient UNAVAILABLE with recovery, DELETED tombstones, candidate-switch
-- retirement blocking old-ref resurrection, and sticky suppression after a
-- memory deletion.

\set ON_ERROR_STOP on

TRUNCATE vc.memory_evidence, vc.memory_embedding, vc.memory_item, vc.st_message_source, vc.conversation_summary,
         vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

-- Chat st-a: initial ingestion and durable refs.
BEGIN;
SELECT vc.set_owner_context(1, 'b177a1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177a1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_state text;
    v_rev   bigint;
    v_loc   text;
    v_count int;
BEGIN
    PERFORM vc.resolve_st_binding(1, 'st-a', 'st-card', 'COMPANION', NULL, '');
    v_state := vc.apply_st_source_snapshot(1, 'st-a', NULL, 1, 'PRESENT', 'st-alpha.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-a","settled":true,"eligible":true},
        {"messageId":"33333333-3333-4333-8333-333333333333","candidateId":"44444444-4444-4444-8444-444444444444","revision":1,"role":"assistant","cipher":"enc2:synthetic-a","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'initial apply must return PRESENT, got %', v_state; END IF;
    SELECT st_applied_revision, st_source_state, st_location INTO v_rev, v_state, v_loc
      FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF v_rev <> 1 OR v_state <> 'PRESENT' OR v_loc <> 'st-alpha.jsonl' THEN
        RAISE EXCEPTION 'conversation source state = %/%/%', v_rev, v_state, v_loc;
    END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1
      AND conversation_id=(SELECT id FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a')
      AND present AND settled AND eligible AND NOT suppressed AND source_generation=1
      AND source_ref IN ('st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1',
                         'st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:1:1');
    IF v_count <> 2 THEN RAISE EXCEPTION 'initial ingestion must persist both durable refs, got %', v_count; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Evidence on both sources stays valid across an idempotent same-revision apply.
BEGIN;
SELECT vc.set_owner_context(1, 'b177a2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177a2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
BEGIN
    SELECT id, relationship_id INTO v_conv, v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status, conversation_id) VALUES
        (1, 1, v_rel, 'RELATIONSHIP', 'synthetic memory on m1', 'ACCEPTED', NULL),
        (2, 1, v_rel, 'RELATIONSHIP', 'synthetic memory on m2', 'ACCEPTED', NULL);
    INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
        (1, 1, 1, 'st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1'),
        (1, 2, 2, 'st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:1:1');
    INSERT INTO vc.conversation_summary(owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence, service_class, valid)
    VALUES (1, 1, v_conv, 1, 2, 'synthetic summary alpha', 'synthetic-model', 'v1', 'pv1', 1.0, 'ECONOMY', true);
END $$;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel  bigint;
    v_state text;
    v_count int;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF NOT vc.st_memory_sources_valid(1, 1) OR NOT vc.st_memory_sources_valid(1, 2) THEN
        RAISE EXCEPTION 'memories must be valid on the current refs';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=1 AND out_chats=ARRAY['st-a'])
       OR NOT EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=2 AND out_chats=ARRAY['st-a']) THEN
        RAISE EXCEPTION 'recall candidates must list both memories with their chat';
    END IF;
    -- Same revision, identical payload: nothing may be invalidated or regenerated.
    v_state := vc.apply_st_source_snapshot(1, 'st-a', 1, 1, 'PRESENT', 'st-alpha.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-a","settled":true,"eligible":true},
        {"messageId":"33333333-3333-4333-8333-333333333333","candidateId":"44444444-4444-4444-8444-444444444444","revision":1,"role":"assistant","cipher":"enc2:synthetic-a","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'idempotent apply must return PRESENT, got %', v_state; END IF;
    IF NOT vc.st_memory_sources_valid(1, 1) OR NOT vc.st_memory_sources_valid(1, 2) THEN
        RAISE EXCEPTION 'idempotent apply must not invalidate evidence';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=1)
       AND EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=2) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'idempotent apply must keep both memories recallable';
    END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND present AND source_generation=1
      AND source_ref IN ('st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1',
                         'st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:1:1');
    IF v_count <> 2 THEN RAISE EXCEPTION 'idempotent apply must not bump generations or refs'; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177a3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177a3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_conv bigint;
BEGIN
    SELECT id INTO v_conv FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF EXISTS (SELECT 1 FROM vc.memory_item WHERE owner_user_id=1 AND id IN (1,2) AND source_invalidated_at IS NOT NULL) THEN
        RAISE EXCEPTION 'idempotent apply must leave source_invalidated_at untouched';
    END IF;
    IF NOT (SELECT valid FROM vc.conversation_summary WHERE owner_user_id=1 AND conversation_id=v_conv) THEN
        RAISE EXCEPTION 'idempotent apply must keep the summary valid';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A new revision retires the old m2 ref and invalidates only its evidence.
BEGIN;
SELECT vc.set_owner_context(1, 'b177a4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177a4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_state text;
    v_count int;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    v_state := vc.apply_st_source_snapshot(1, 'st-a', 1, 2, 'PRESENT', 'st-alpha.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-a","settled":true,"eligible":true},
        {"messageId":"33333333-3333-4333-8333-333333333333","candidateId":"44444444-4444-4444-8444-444444444444","revision":2,"role":"assistant","cipher":"enc2:synthetic-a2","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'revision 2 apply must return PRESENT, got %', v_state; END IF;
    -- m2 moves to the new ref; m1 keeps its ref and generation.
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND present
      AND source_ref='st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:2:2'
      AND source_revision=2 AND source_generation=2;
    IF v_count <> 1 THEN RAISE EXCEPTION 'edited message must advance to ref rev2/gen2'; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1
      AND source_ref='st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:1:1';
    IF v_count <> 0 THEN RAISE EXCEPTION 'old m2 ref must not survive the edit'; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND present
      AND source_ref='st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1'
      AND source_revision=1 AND source_generation=1;
    IF v_count <> 1 THEN RAISE EXCEPTION 'untouched message must keep its ref'; END IF;
    IF vc.st_memory_sources_valid(1, 2) THEN RAISE EXCEPTION 'evidence on the retired ref must be invalid'; END IF;
    IF NOT vc.st_memory_sources_valid(1, 1) THEN RAISE EXCEPTION 'evidence on the untouched ref must stay valid'; END IF;
    IF EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=2) THEN
        RAISE EXCEPTION 'memory on the retired ref must leave recall candidates';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=1) THEN
        RAISE EXCEPTION 'memory on the untouched ref must stay recallable';
    END IF;
    IF NOT vc.guard_st_memory_source(1, v_rel, 'st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1') THEN
        RAISE EXCEPTION 'guard must accept the current m1 ref';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177a5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177a5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_conv bigint;
BEGIN
    SELECT id INTO v_conv FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF (SELECT source_invalidated_at FROM vc.memory_item WHERE owner_user_id=1 AND id=2) IS NULL THEN
        RAISE EXCEPTION 'new revision must mark the old evidence invalidated';
    END IF;
    IF (SELECT source_invalidated_at FROM vc.memory_item WHERE owner_user_id=1 AND id=1) IS NOT NULL THEN
        RAISE EXCEPTION 'untouched evidence must not be invalidated';
    END IF;
    IF (SELECT valid FROM vc.conversation_summary WHERE owner_user_id=1 AND conversation_id=v_conv) THEN
        RAISE EXCEPTION 'summary must be pending rebuild after a source edit';
    END IF;
END $$;
RESET ROLE;
COMMIT;

-- Stale requested revision: RETRY without rollback; older observed revisions
-- and stale message payloads degrade to UNAVAILABLE without mutating state.
BEGIN;
SELECT vc.set_owner_context(1, 'b177a6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177a6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_state text;
    v_rev   bigint;
    v_count int;
BEGIN
    v_state := vc.apply_st_source_snapshot(1, 'st-a', 1, 2, 'PRESENT', 'st-alpha.jsonl', '[]'::jsonb);
    IF v_state <> 'RETRY' THEN RAISE EXCEPTION 'stale requested revision must return RETRY, got %', v_state; END IF;
    v_state := vc.apply_st_source_snapshot(1, 'st-a', NULL, 2, 'PRESENT', 'st-alpha.jsonl', '[]'::jsonb);
    IF v_state <> 'RETRY' THEN RAISE EXCEPTION 'NULL requested revision after apply must return RETRY, got %', v_state; END IF;
    SELECT st_applied_revision, st_source_state INTO v_rev, v_state FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF v_rev <> 2 OR v_state <> 'PRESENT' THEN RAISE EXCEPTION 'RETRY must not roll back applied state: %/%', v_rev, v_state; END IF;
    -- An older observed revision must not regress the durable index.
    v_state := vc.apply_st_source_snapshot(1, 'st-a', 2, 1, 'PRESENT', 'st-alpha.jsonl', '[]'::jsonb);
    IF v_state <> 'UNAVAILABLE' THEN RAISE EXCEPTION 'revision regression must return UNAVAILABLE, got %', v_state; END IF;
    SELECT st_applied_revision, st_source_state INTO v_rev, v_state FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF v_rev <> 2 OR v_state <> 'UNAVAILABLE' THEN RAISE EXCEPTION 'regression handling must keep revision 2: %/%', v_rev, v_state; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND present AND source_ref IN (
        'st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1',
        'st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:2:2');
    IF v_count <> 2 THEN RAISE EXCEPTION 'regression handling must not mutate sources'; END IF;
    -- A payload carrying an older revision than the durable row is rejected whole.
    v_state := vc.apply_st_source_snapshot(1, 'st-a', 2, 3, 'PRESENT', 'st-alpha.jsonl', $j$[
        {"messageId":"33333333-3333-4333-8333-333333333333","candidateId":"44444444-4444-4444-8444-444444444444","revision":1,"role":"assistant","cipher":"enc2:stale","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'UNAVAILABLE' THEN RAISE EXCEPTION 'stale message payload must return UNAVAILABLE, got %', v_state; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND present AND source_ref IN (
        'st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1',
        'st:st-a:33333333-3333-4333-8333-333333333333:44444444-4444-4444-8444-444444444444:2:2');
    IF v_count <> 2 THEN RAISE EXCEPTION 'stale payload rejection must be atomic'; END IF;
    -- Recovery from the degraded marker at the still-current revision.
    v_state := vc.apply_st_source_snapshot(1, 'st-a', 2, 2, 'PRESENT', 'st-alpha.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-a","settled":true,"eligible":true},
        {"messageId":"33333333-3333-4333-8333-333333333333","candidateId":"44444444-4444-4444-8444-444444444444","revision":2,"role":"assistant","cipher":"enc2:synthetic-a2","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'recovery apply must return PRESENT, got %', v_state; END IF;
    SELECT st_applied_revision, st_source_state INTO v_rev, v_state FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    IF v_rev <> 2 OR v_state <> 'PRESENT' THEN RAISE EXCEPTION 'recovery must restore PRESENT at revision 2: %/%', v_rev, v_state; END IF;
    IF NOT vc.st_memory_sources_valid(1, 1) THEN RAISE EXCEPTION 'valid evidence must survive the degraded window'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Chat st-b: transient UNAVAILABLE never permanently invalidates evidence.
BEGIN;
SELECT vc.set_owner_context(1, 'b177b1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177b1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_state text; v_rev bigint; v_count int;
BEGIN
    PERFORM vc.resolve_st_binding(1, 'st-b', 'st-card', 'COMPANION', NULL, '');
    v_state := vc.apply_st_source_snapshot(1, 'st-b', NULL, 1, 'PRESENT', 'st-beta.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-b","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-b initial apply must return PRESENT, got %', v_state; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177b2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177b2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_rel bigint;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-b';
    INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status, conversation_id)
        VALUES (3, 1, v_rel, 'RELATIONSHIP', 'synthetic memory on st-b', 'ACCEPTED', NULL);
    INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
        (1, 3, 3, 'st:st-b:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
END $$;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_state text;
    v_rev   bigint;
    v_count int;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-b';
    IF NOT vc.st_memory_sources_valid(1, 3) THEN RAISE EXCEPTION 'st-b memory must start valid'; END IF;
    v_state := vc.apply_st_source_snapshot(1, 'st-b', 1, NULL, 'UNAVAILABLE', NULL, NULL);
    IF v_state <> 'UNAVAILABLE' THEN RAISE EXCEPTION 'transient report must return UNAVAILABLE, got %', v_state; END IF;
    SELECT st_applied_revision, st_source_state INTO v_rev, v_state FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-b';
    IF v_rev <> 1 OR v_state <> 'UNAVAILABLE' THEN RAISE EXCEPTION 'unavailable marker must keep revision 1: %/%', v_rev, v_state; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND present
      AND source_ref='st:st-b:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1'
      AND source_generation=1;
    IF v_count <> 1 THEN RAISE EXCEPTION 'unavailable must not retire the source row'; END IF;
    IF vc.st_memory_sources_valid(1, 3) THEN RAISE EXCEPTION 'evidence must not verify while the chat is unavailable'; END IF;
    -- Discovery keeps unavailable dependencies so a later read can recover.
    IF NOT EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=3) THEN
        RAISE EXCEPTION 'unavailable source must remain discoverable for recovery';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.go_select_recall_memories(1, v_rel, NULL, 'RELATIONSHIP', 50) WHERE out_id=3) THEN
        RAISE EXCEPTION 'unverifiable source must never enter effective recall';
    END IF;
    -- Recovery at the same revision restores everything without regeneration.
    v_state := vc.apply_st_source_snapshot(1, 'st-b', 1, 1, 'PRESENT', 'st-beta.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-b","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-b recovery must return PRESENT, got %', v_state; END IF;
    IF NOT vc.st_memory_sources_valid(1, 3) THEN RAISE EXCEPTION 'recovery must restore evidence validity'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.go_select_recall_memories(1, v_rel, NULL, 'RELATIONSHIP', 50) WHERE out_id=3) THEN
        RAISE EXCEPTION 'recovery must restore effective recall';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=3 AND out_chats=ARRAY['st-b']) THEN
        RAISE EXCEPTION 'recovery must restore recall candidacy';
    END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1
      AND source_ref='st:st-b:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1';
    IF v_count <> 1 THEN RAISE EXCEPTION 'recovery must not duplicate or regenerate the row'; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177b3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177b3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    IF (SELECT source_invalidated_at FROM vc.memory_item WHERE owner_user_id=1 AND id=3) IS NOT NULL THEN
        RAISE EXCEPTION 'transient unavailability must not permanently invalidate evidence';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Chat st-c: durable DELETED tombstone cannot be undone.
BEGIN;
SELECT vc.set_owner_context(1, 'b177c1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177c1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_state text;
BEGIN
    PERFORM vc.resolve_st_binding(1, 'st-c', 'st-card', 'COMPANION', NULL, '');
    v_state := vc.apply_st_source_snapshot(1, 'st-c', NULL, 1, 'PRESENT', 'st-charlie.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-c","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-c initial apply must return PRESENT, got %', v_state; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177c2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177c2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_rel bigint; v_conv bigint;
BEGIN
    SELECT id, relationship_id INTO v_conv, v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-c';
    INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status, conversation_id)
        VALUES (4, 1, v_rel, 'RELATIONSHIP', 'synthetic memory on st-c', 'ACCEPTED', NULL);
    INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
        (1, 4, 4, 'st:st-c:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
    INSERT INTO vc.conversation_summary(owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence, service_class, valid)
    VALUES (1, 2, v_conv, 1, 1, 'synthetic summary charlie', 'synthetic-model', 'v1', 'pv1', 1.0, 'PREMIUM', true);
END $$;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_conv  bigint;
    v_state text;
    v_rev   bigint;
    v_row   record;
BEGIN
    SELECT id, relationship_id INTO v_conv, v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-c';
    IF NOT vc.st_memory_sources_valid(1, 4) THEN RAISE EXCEPTION 'st-c memory must start valid'; END IF;
    v_state := vc.apply_st_source_snapshot(1, 'st-c', 1, 2, 'DELETED', NULL, NULL);
    IF v_state <> 'DELETED' THEN RAISE EXCEPTION 'deletion must return DELETED, got %', v_state; END IF;
    SELECT st_applied_revision, st_source_state INTO v_rev, v_state FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-c';
    IF v_rev <> 2 OR v_state <> 'DELETED' THEN RAISE EXCEPTION 'tombstone must record revision 2/DELETED: %/%', v_rev, v_state; END IF;
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1
      AND conversation_id=v_conv;
    IF v_row.present OR v_row.settled OR v_row.content_cipher <> '' OR v_row.source_generation <> 2
       OR v_row.source_ref <> 'st:st-c:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:2' THEN
        RAISE EXCEPTION 'deleted sources must be retired with a bumped ref: %', v_row.source_ref;
    END IF;
    IF vc.st_memory_sources_valid(1, 4) THEN RAISE EXCEPTION 'evidence on a deleted chat must be invalid'; END IF;
    IF EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=4) THEN
        RAISE EXCEPTION 'deleted-chat memory must leave recall candidates';
    END IF;
    IF vc.guard_st_memory_source(1, v_rel, 'st:st-c:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:2') THEN
        RAISE EXCEPTION 'guard must reject retired sources';
    END IF;
    BEGIN
        PERFORM vc.apply_st_source_snapshot(1, 'st-c', 2, 3, 'PRESENT', 'st-charlie.jsonl', '[]'::jsonb);
        RAISE EXCEPTION 'a deleted chat must not reappear as PRESENT';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'apply_st_source_snapshot: deleted chat cannot reappear' THEN RAISE; END IF;
    END;
    -- An availability failure cannot erase the durable deletion decision.
    v_state := vc.apply_st_source_snapshot(1, 'st-c', 2, NULL, 'UNAVAILABLE', NULL, NULL);
    IF v_state <> 'DELETED' THEN RAISE EXCEPTION 'unavailable after deletion must return DELETED, got %', v_state; END IF;
    SELECT st_source_state INTO v_state FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-c';
    IF v_state <> 'DELETED' THEN RAISE EXCEPTION 'unavailable must not unmark the tombstone: %', v_state; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177c3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177c3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_conv bigint;
BEGIN
    SELECT id INTO v_conv FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-c';
    IF (SELECT source_invalidated_at FROM vc.memory_item WHERE owner_user_id=1 AND id=4) IS NULL THEN
        RAISE EXCEPTION 'deletion must invalidate the memory evidence';
    END IF;
    IF (SELECT valid FROM vc.conversation_summary WHERE owner_user_id=1 AND conversation_id=v_conv) THEN
        RAISE EXCEPTION 'deletion must mark the summary pending rebuild';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Chat st-d: candidate switch retires the old candidate; a stale task cannot
-- re-attach evidence to the retired ref.
BEGIN;
SELECT vc.set_owner_context(1, 'b177d1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177d1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_state text;
BEGIN
    PERFORM vc.resolve_st_binding(1, 'st-d', 'st-card', 'COMPANION', NULL, '');
    v_state := vc.apply_st_source_snapshot(1, 'st-d', NULL, 1, 'PRESENT', 'st-delta.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-d","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-d initial apply must return PRESENT, got %', v_state; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177d2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177d2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_rel bigint;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-d';
    INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status, conversation_id) VALUES
        (5, 1, v_rel, 'RELATIONSHIP', 'synthetic memory on st-d', 'ACCEPTED', NULL),
        (7, 1, v_rel, 'RELATIONSHIP', 'synthetic late-task memory', 'ACCEPTED', NULL);
    INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
        (1, 5, 5, 'st:st-d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
END $$;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_conv  bigint;
    v_state text;
    v_row   record;
    v_count int;
BEGIN
    SELECT id, relationship_id INTO v_conv, v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-d';
    IF NOT vc.st_memory_sources_valid(1, 5) THEN RAISE EXCEPTION 'st-d memory must start valid'; END IF;
    -- The message switches from candidate C1 to C1B (a swipe reselection).
    v_state := vc.apply_st_source_snapshot(1, 'st-d', 1, 2, 'PRESENT', 'st-delta.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"66666666-6666-4666-8666-666666666666","revision":1,"role":"user","cipher":"enc2:synthetic-d","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'candidate switch must return PRESENT, got %', v_state; END IF;
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=v_conv
      AND candidate_id='22222222-2222-4222-8222-222222222222'::uuid;
    IF v_row.present OR v_row.content_cipher <> '' OR v_row.source_generation <> 2
       OR v_row.source_ref <> 'st:st-d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:2' THEN
        RAISE EXCEPTION 'deselected candidate must be retired with a bumped ref';
    END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=v_conv
      AND present AND candidate_id='66666666-6666-4666-8666-666666666666'::uuid
      AND source_ref='st:st-d:11111111-1111-4111-8111-111111111111:66666666-6666-4666-8666-666666666666:1:1'
      AND source_generation=1;
    IF v_count <> 1 THEN RAISE EXCEPTION 'selected candidate must be present under its own ref'; END IF;
    IF vc.st_memory_sources_valid(1, 5) THEN RAISE EXCEPTION 'evidence on the deselected candidate must be invalid'; END IF;
    IF EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=5) THEN
        RAISE EXCEPTION 'st-d memory must leave recall candidates after the switch';
    END IF;
    IF vc.guard_st_memory_source(1, v_rel, 'st:st-d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1') THEN
        RAISE EXCEPTION 'guard must reject the retired candidate ref';
    END IF;
    IF NOT vc.guard_st_memory_source(1, v_rel, 'st:st-d:11111111-1111-4111-8111-111111111111:66666666-6666-4666-8666-666666666666:1:1') THEN
        RAISE EXCEPTION 'guard must accept the newly selected candidate';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177d3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177d3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    -- A late extraction task cannot resurrect the retired ref as evidence.
    BEGIN
        INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
            (1, 7, 7, 'st:st-d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
        RAISE EXCEPTION 'evidence insertion on a retired ref must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'ST source is not current or eligible' THEN RAISE; END IF;
    END;
    IF (SELECT source_invalidated_at FROM vc.memory_item WHERE owner_user_id=1 AND id=5) IS NULL THEN
        RAISE EXCEPTION 'candidate switch must invalidate the old evidence';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Deleting a memory while its candidate is retired still suppresses the row
-- (matched by chat/message/candidate/revision, not by generation), and the
-- suppression survives the candidate's restoration.
BEGIN;
SELECT vc.set_owner_context(1, 'b177d4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177d4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_row  record;
BEGIN
    UPDATE vc.memory_item SET deleted_at=now() WHERE owner_user_id=1 AND id=5 AND deleted_at IS NULL;
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1
      AND conversation_id=(SELECT id FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-d')
      AND candidate_id='22222222-2222-4222-8222-222222222222'::uuid;
    IF NOT v_row.suppressed OR v_row.present THEN
        RAISE EXCEPTION 'deleting a memory during candidate retirement must suppress the retired row';
    END IF;
END $$;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_state text;
    v_row   record;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-d';
    -- Restore the deselected candidate: the row returns at a new generation
    -- but keeps the suppression earned by the deletion.
    v_state := vc.apply_st_source_snapshot(1, 'st-d', 2, 3, 'PRESENT', 'st-delta.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-d","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'candidate restoration must return PRESENT, got %', v_state; END IF;
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1
      AND conversation_id=(SELECT id FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-d')
      AND candidate_id='22222222-2222-4222-8222-222222222222'::uuid;
    IF NOT v_row.present OR NOT v_row.suppressed OR v_row.source_generation <> 3
       OR v_row.source_ref <> 'st:st-d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:3' THEN
        RAISE EXCEPTION 'restored candidate must be present, still suppressed, at ref %', v_row.source_ref;
    END IF;
    IF vc.guard_st_memory_source(1, v_rel, 'st:st-d:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:3') THEN
        RAISE EXCEPTION 'guard must reject a candidate restored after memory deletion';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Chat st-e: suppression caused by a memory deletion survives restores and
-- reselections of the same candidate.
BEGIN;
SELECT vc.set_owner_context(1, 'b177e1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177e1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_state text;
BEGIN
    PERFORM vc.resolve_st_binding(1, 'st-e', 'st-card', 'COMPANION', NULL, '');
    v_state := vc.apply_st_source_snapshot(1, 'st-e', NULL, 1, 'PRESENT', 'st-echo.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-e","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-e initial apply must return PRESENT, got %', v_state; END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177e2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177e2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE v_rel bigint;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-e';
    INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status, conversation_id) VALUES
        (6, 1, v_rel, 'RELATIONSHIP', 'synthetic memory on st-e', 'ACCEPTED', NULL),
        (8, 1, v_rel, 'RELATIONSHIP', 'synthetic post-delete memory', 'ACCEPTED', NULL);
    INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
        (1, 6, 6, 'st:st-e:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
    UPDATE vc.memory_item SET deleted_at=now() WHERE owner_user_id=1 AND id=6;
END $$;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel   bigint;
    v_conv  bigint;
    v_state text;
    v_row   record;
BEGIN
    SELECT id, relationship_id INTO v_conv, v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-e';
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=v_conv;
    IF NOT v_row.suppressed OR NOT v_row.present THEN
        RAISE EXCEPTION 'memory deletion must suppress the cited source without retiring it';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.st_recall_candidates(1, v_rel, NULL, 'RELATIONSHIP') WHERE out_memory_id=6) THEN
        RAISE EXCEPTION 'deleted memory must not appear in recall candidates';
    END IF;
    IF vc.guard_st_memory_source(1, v_rel, v_row.source_ref) THEN
        RAISE EXCEPTION 'suppressed source must fail the guard';
    END IF;
    -- Re-applying the same revision (restore) must not clear the suppression.
    v_state := vc.apply_st_source_snapshot(1, 'st-e', 1, 1, 'PRESENT', 'st-echo.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-e","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-e re-apply must return PRESENT, got %', v_state; END IF;
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=v_conv;
    IF NOT v_row.suppressed OR v_row.source_ref <> 'st:st-e:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1' THEN
        RAISE EXCEPTION 'suppression must survive a same-revision restore';
    END IF;
    -- A newer revision of the same candidate must not clear it either.
    v_state := vc.apply_st_source_snapshot(1, 'st-e', 1, 2, 'PRESENT', 'st-echo.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":2,"role":"user","cipher":"enc2:synthetic-e2","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'st-e revision 2 must return PRESENT, got %', v_state; END IF;
    SELECT * INTO v_row FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=v_conv;
    IF NOT v_row.suppressed OR v_row.source_ref <> 'st:st-e:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:2:2' THEN
        RAISE EXCEPTION 'suppression must stay sticky across a revision advance';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'b177e3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177e3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    -- Suppressed sources cannot back brand-new memories either.
    BEGIN
        INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
            (1, 8, 8, 'st:st-e:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:2:2');
        RAISE EXCEPTION 'evidence insertion on a suppressed ref must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'ST source is not current or eligible' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

-- Isolation: forged owners, unknown chats, invalid states and direct writes
-- are rejected for the current trusted owner.
BEGIN;
SELECT vc.set_owner_context(1, 'b177i1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177i1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE v_rel bigint; v_denied boolean;
BEGIN
    SELECT relationship_id INTO v_rel FROM vc.conversation WHERE owner_user_id=1 AND st_chat_identity='st-a';
    BEGIN
        PERFORM vc.apply_st_source_snapshot(2, 'st-a', NULL, 1, 'PRESENT', 'x', '[]'::jsonb);
        RAISE EXCEPTION 'another owner id must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'apply_st_source_snapshot: trusted owner required' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.apply_st_source_snapshot(1, 'st-missing', NULL, 1, 'PRESENT', 'x', '[]'::jsonb);
        RAISE EXCEPTION 'an unbound chat must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'apply_st_source_snapshot: binding not found' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.apply_st_source_snapshot(1, 'st-a', 2, 3, 'FLYING', 'x', '[]'::jsonb);
        RAISE EXCEPTION 'an unknown state must be rejected';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'apply_st_source_snapshot: invalid state' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.guard_st_memory_source(2, v_rel, 'st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
        RAISE EXCEPTION 'guard must reject another owner id';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'guard_st_memory_source: trusted owner required' THEN RAISE; END IF;
    END;
    v_denied := false;
    BEGIN
        INSERT INTO vc.st_message_source(owner_user_id,conversation_id,message_id,candidate_id,source_revision,source_generation,source_ref,role,content_cipher,present,settled,eligible)
        VALUES (1,1,'11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',1,1,'st:forge','user','x',true,true,true);
    EXCEPTION WHEN insufficient_privilege THEN
        v_denied := true;
    END;
    IF NOT v_denied THEN RAISE EXCEPTION 'runtime roles must not write the source index directly'; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 sees only their own rows and cannot touch owner 1's bindings.
BEGIN;
SELECT vc.set_owner_context(2, 'b177i2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b177i2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_state text;
    v_count int;
BEGIN
    PERFORM vc.resolve_st_binding(2, 'st-f', 'st-card', 'COMPANION', NULL, '');
    v_state := vc.apply_st_source_snapshot(2, 'st-f', NULL, 1, 'PRESENT', 'st-foxtrot.jsonl', $j$[
        {"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"enc2:synthetic-f","settled":true,"eligible":true}
    ]$j$::jsonb);
    IF v_state <> 'PRESENT' THEN RAISE EXCEPTION 'owner 2 ingestion must return PRESENT, got %', v_state; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source;
    IF v_count <> 1 THEN RAISE EXCEPTION 'RLS must expose exactly the current owner row, got %', v_count; END IF;
    SELECT count(*) INTO v_count FROM vc.st_message_source WHERE owner_user_id=1;
    IF v_count <> 0 THEN RAISE EXCEPTION 'RLS must hide owner 1 sources from owner 2'; END IF;
    BEGIN
        PERFORM vc.apply_st_source_snapshot(2, 'st-a', NULL, 1, 'PRESENT', 'x', '[]'::jsonb);
        RAISE EXCEPTION 'owner 2 must not reach owner 1 chats by identity';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'apply_st_source_snapshot: binding not found' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.guard_st_memory_source(1, 1, 'st:st-a:11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:1:1');
        RAISE EXCEPTION 'guard must reject cross-owner refs';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM <> 'guard_st_memory_source: trusted owner required' THEN RAISE; END IF;
    END;
END $$;
COMMIT;
RESET ROLE;
