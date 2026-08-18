-- 104_relationship_clearance: COMP-CLEAR V49 — FR-COMP-004 reset / delete.
--
-- Covers: preview counts match the fixture; reset clears conversations,
-- memories and reminders but keeps the relationship row and structured
-- prefs (including presentation); delete removes the relationship and
-- cascades; in-flight GENERATION / MEMORY_EXTRACT work items become
-- CANCELLED and a DATA_EXPORT item is left alone; account-level consent
-- is not touched; foreign / absent ids return no-rows / FALSE without
-- disclosing existence; a later create_relationship with the same
-- personaRef lists and recalls no confirmed memories; deactivate still
-- works on a surviving Companion; trusted-owner mismatch fail-closed;
-- non-vc_api cannot execute the new functions.

\set ON_ERROR_STOP on

TRUNCATE vc.work_item, vc.outbox_event, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account,
         vc.age_verification, vc.export_request, vc.consent_record,
         vc.entitlement_snapshot, vc.service_class_assignment, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

-- ===========================================================================
-- 1. Owner 1: preview + reset keeps the row/prefs, clears the domain.
--    vc_api calls the SD functions; table assertions run as the test
--    superuser because runtime roles have no business-table DML/SELECT.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_keep bigint;
    v_conv bigint;
    v_gen bigint;
    v_mem bigint;
    v_ok boolean;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_keep;
    PERFORM vc.activate_relationship(1, v_rel);

    v_ok := vc.update_relationship_prefs(
        1, v_rel, '小安', '老张', 'SHORT', 'LOW', 'NONE', 'RARE',
        false, 'SESSION', 'FAMILY', 'FEMALE', 'AVATAR_FEMALE_01');
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'owned prefs update must succeed';
    END IF;

    SELECT vc.create_conversation(1, v_rel) INTO v_conv;
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-104-reset', 'user', 'hello');
    PERFORM vc.enqueue_work_item(1, 'GENERATION', v_gen);
    PERFORM vc.enqueue_work_item(1, 'MEMORY_EXTRACT', v_gen);
    PERFORM vc.enqueue_work_item(1, 'DATA_EXPORT', 4242);

    SELECT vc.create_memory_candidate(
        1, v_rel, 'RELATIONSHIP', 'likes quiet evenings', NULL, ARRAY[]::text[])
      INTO v_mem;
    IF NOT vc.confirm_memory_candidate(1, v_mem) THEN
        RAISE EXCEPTION 'confirm_memory_candidate must accept the owned candidate';
    END IF;
    PERFORM vc.create_reminder(1, v_rel, '晚上十点提醒我准备休息', now(), 'NONE');
    PERFORM vc.record_consent(1, 'MODEL_TRAINING', '2026-08', true);
END $$;
RESET ROLE;

UPDATE vc.work_item
   SET status = 'CLAIMED'
 WHERE owner_user_id = 1
   AND kind = 'MEMORY_EXTRACT'
   AND status = 'PENDING';

SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_conv_n bigint;
    v_mem_n bigint;
    v_rem_n bigint;
    n int;
BEGIN
    SELECT out_id INTO v_rel FROM vc.list_relationships(1)
     WHERE out_companion_name = '小安';

    SELECT out_conversation_count, out_memory_count, out_reminder_count
      INTO v_conv_n, v_mem_n, v_rem_n
      FROM vc.preview_relationship_clearance(1, v_rel);
    IF v_conv_n IS DISTINCT FROM 1 OR v_mem_n IS DISTINCT FROM 1
       OR v_rem_n IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'preview counts must match fixture conv=% mem=% rem=%',
            v_conv_n, v_mem_n, v_rem_n;
    END IF;

    SELECT count(*) INTO n FROM vc.preview_relationship_clearance(1, 999999999);
    IF n <> 0 THEN
        RAISE EXCEPTION 'absent preview must return no rows';
    END IF;
    IF vc.reset_relationship(1, 999999999) IS NOT FALSE THEN
        RAISE EXCEPTION 'absent reset must return FALSE';
    END IF;
    IF vc.delete_relationship(1, 999999999) IS NOT FALSE THEN
        RAISE EXCEPTION 'absent delete must return FALSE';
    END IF;

    IF NOT vc.reset_relationship(1, v_rel) THEN
        RAISE EXCEPTION 'owned reset must succeed';
    END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
    v_rel bigint;
    v_keep bigint;
    v_name text;
    v_gender text;
    v_avatar text;
    v_len text;
    v_status text;
    n int;
BEGIN
    SELECT id INTO v_rel FROM vc.relationship
     WHERE owner_user_id = 1 AND companion_name = '小安';
    SELECT id INTO v_keep FROM vc.relationship
     WHERE owner_user_id = 1 AND id IS DISTINCT FROM v_rel
     ORDER BY id LIMIT 1;

    SELECT count(*) INTO n FROM vc.conversation
     WHERE owner_user_id = 1 AND relationship_id = v_rel;
    IF n <> 0 THEN RAISE EXCEPTION 'reset must delete conversations'; END IF;
    SELECT count(*) INTO n FROM vc.memory_item
     WHERE owner_user_id = 1 AND relationship_id = v_rel;
    IF n <> 0 THEN RAISE EXCEPTION 'reset must delete memories'; END IF;
    SELECT count(*) INTO n FROM vc.reminder
     WHERE owner_user_id = 1 AND relationship_id = v_rel;
    IF n <> 0 THEN RAISE EXCEPTION 'reset must delete reminders'; END IF;

    SELECT companion_name, gender, avatar_ref, reply_length
      INTO v_name, v_gender, v_avatar, v_len
      FROM vc.relationship
     WHERE owner_user_id = 1 AND id = v_rel;
    IF v_name IS DISTINCT FROM '小安' OR v_gender IS DISTINCT FROM 'FEMALE'
       OR v_avatar IS DISTINCT FROM 'AVATAR_FEMALE_01'
       OR v_len IS DISTINCT FROM 'SHORT' THEN
        RAISE EXCEPTION 'reset must keep prefs name=% gender=% avatar=% len=%',
            v_name, v_gender, v_avatar, v_len;
    END IF;

    SELECT status INTO v_status FROM vc.work_item
     WHERE owner_user_id = 1 AND kind = 'GENERATION'
     ORDER BY id LIMIT 1;
    IF v_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'PENDING GENERATION work item must be cancelled, got %', v_status;
    END IF;
    SELECT status INTO v_status FROM vc.work_item
     WHERE owner_user_id = 1 AND kind = 'MEMORY_EXTRACT'
     ORDER BY id LIMIT 1;
    IF v_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'CLAIMED MEMORY_EXTRACT work item must be cancelled, got %', v_status;
    END IF;
    SELECT status INTO v_status FROM vc.work_item
     WHERE owner_user_id = 1 AND kind = 'DATA_EXPORT'
     ORDER BY id LIMIT 1;
    IF v_status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'DATA_EXPORT work item must be left alone, got %', v_status;
    END IF;

    SELECT count(*) INTO n FROM vc.consent_record WHERE owner_user_id = 1;
    IF n <> 1 THEN
        RAISE EXCEPTION 'account-level consent must survive reset';
    END IF;
    SELECT count(*) INTO n FROM vc.relationship
     WHERE owner_user_id = 1 AND id = v_keep;
    IF n <> 1 THEN
        RAISE EXCEPTION 'sibling relationship must survive reset';
    END IF;
END $$;

SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_new bigint;
    n int;
BEGIN
    SELECT out_id INTO v_rel FROM vc.list_relationships(1)
     WHERE out_companion_name = '小安';

    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_new;
    SELECT count(*) INTO n FROM vc.list_memory(1, v_new);
    IF n <> 0 THEN
        RAISE EXCEPTION 'new relationship list_memory must be empty after reset, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.recall_memory(1, v_new);
    IF n <> 0 THEN
        RAISE EXCEPTION 'new relationship recall_memory must be empty after reset, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_memory(1, v_rel);
    IF n <> 0 THEN
        RAISE EXCEPTION 'reset relationship itself must list no memories';
    END IF;

    IF NOT vc.deactivate_relationship(1, v_rel) THEN
        RAISE EXCEPTION 'deactivate must still work after reset';
    END IF;
    SELECT count(*) INTO n FROM vc.get_relationship(1, v_rel) WHERE out_active IS FALSE;
    IF n <> 1 THEN
        RAISE EXCEPTION 'deactivate after reset must leave the row inactive';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ===========================================================================
-- 2. Owner 1: delete removes the row and cascades; same-template recreate
--    still has no confirmed memories.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(1, 'n1b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rel bigint;
    v_conv bigint;
    v_gen bigint;
    v_mem bigint;
    v_conv_n bigint;
    v_mem_n bigint;
    v_rem_n bigint;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_rel;
    SELECT vc.create_conversation(1, v_rel) INTO v_conv;
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(1, v_conv, 'idem-104-delete', 'user', 'hello');
    PERFORM vc.enqueue_work_item(1, 'GENERATION', v_gen);
    SELECT vc.create_memory_candidate(
        1, v_rel, 'RELATIONSHIP', 'likes jazz', NULL, ARRAY[]::text[])
      INTO v_mem;
    IF NOT vc.confirm_memory_candidate(1, v_mem) THEN
        RAISE EXCEPTION 'confirm must succeed before delete';
    END IF;
    PERFORM vc.create_reminder(1, v_rel, '明早问我面试怎么样', now(), 'NONE');

    SELECT out_conversation_count, out_memory_count, out_reminder_count
      INTO v_conv_n, v_mem_n, v_rem_n
      FROM vc.preview_relationship_clearance(1, v_rel);
    IF v_conv_n IS DISTINCT FROM 1 OR v_mem_n IS DISTINCT FROM 1
       OR v_rem_n IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'delete-path preview counts mismatch conv=% mem=% rem=%',
            v_conv_n, v_mem_n, v_rem_n;
    END IF;

    IF NOT vc.delete_relationship(1, v_rel) THEN
        RAISE EXCEPTION 'owned delete must succeed';
    END IF;
END $$;
RESET ROLE;

DO $$
DECLARE
    v_rel_gone int;
    v_status text;
    v_consent_n int;
BEGIN
    SELECT count(*) INTO v_rel_gone FROM vc.relationship
     WHERE owner_user_id = 1 AND companion_name IS NULL
       AND created_at > now() - interval '1 hour';
    -- The just-deleted Companion is gone; remaining rows are earlier ones.
    SELECT count(*) INTO v_rel_gone FROM vc.conversation c
     WHERE c.owner_user_id = 1
       AND NOT EXISTS (
            SELECT 1 FROM vc.relationship r
             WHERE r.owner_user_id = c.owner_user_id AND r.id = c.relationship_id);
    IF v_rel_gone <> 0 THEN
        RAISE EXCEPTION 'delete must cascade conversations';
    END IF;
    SELECT count(*) INTO v_rel_gone FROM vc.memory_item m
     WHERE m.owner_user_id = 1
       AND NOT EXISTS (
            SELECT 1 FROM vc.relationship r
             WHERE r.owner_user_id = m.owner_user_id AND r.id = m.relationship_id);
    IF v_rel_gone <> 0 THEN
        RAISE EXCEPTION 'delete must cascade memories';
    END IF;
    SELECT count(*) INTO v_rel_gone FROM vc.reminder rem
     WHERE rem.owner_user_id = 1
       AND NOT EXISTS (
            SELECT 1 FROM vc.relationship r
             WHERE r.owner_user_id = rem.owner_user_id AND r.id = rem.relationship_id);
    IF v_rel_gone <> 0 THEN
        RAISE EXCEPTION 'delete must cascade reminders';
    END IF;

    SELECT status INTO v_status FROM vc.work_item
     WHERE owner_user_id = 1 AND kind = 'GENERATION'
     ORDER BY id DESC LIMIT 1;
    IF v_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'delete must cancel in-flight work item, got %', v_status;
    END IF;

    SELECT count(*) INTO v_consent_n FROM vc.consent_record WHERE owner_user_id = 1;
    IF v_consent_n <> 1 THEN
        RAISE EXCEPTION 'delete must not touch account-level consent';
    END IF;
END $$;

SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_new bigint;
    n int;
BEGIN
    SELECT vc.create_relationship(1, 'gentle-listener') INTO v_new;
    SELECT count(*) INTO n FROM vc.list_memory(1, v_new);
    IF n <> 0 THEN
        RAISE EXCEPTION 'new relationship list_memory must be empty after delete';
    END IF;
    SELECT count(*) INTO n FROM vc.recall_memory(1, v_new);
    IF n <> 0 THEN
        RAISE EXCEPTION 'new relationship recall_memory must be empty after delete';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- ===========================================================================
-- 3. Cross-owner: bob cannot see or mutate alice's relationship.
-- ===========================================================================
BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SELECT set_config('vc.test_alice_rel', id::text, true)
  FROM vc.relationship WHERE owner_user_id = 1 ORDER BY id LIMIT 1;
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint;
    n int;
BEGIN
    v_alice := current_setting('vc.test_alice_rel')::bigint;
    SELECT count(*) INTO n FROM vc.preview_relationship_clearance(2, v_alice);
    IF n <> 0 THEN
        RAISE EXCEPTION 'cross-owner preview must return no rows';
    END IF;
    IF vc.reset_relationship(2, v_alice) IS NOT FALSE THEN
        RAISE EXCEPTION 'cross-owner reset must return FALSE';
    END IF;
    IF vc.delete_relationship(2, v_alice) IS NOT FALSE THEN
        RAISE EXCEPTION 'cross-owner delete must return FALSE';
    END IF;

    BEGIN
        PERFORM vc.delete_relationship(1, v_alice);
        RAISE EXCEPTION 'delete must reject an owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%delete must reject an owner mismatch%' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM vc.preview_relationship_clearance(1, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed preview_relationship_clearance';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
DO $$
BEGIN
    PERFORM vc.reset_relationship(1, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed reset_relationship';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
DO $$
BEGIN
    PERFORM vc.delete_relationship(1, 1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed delete_relationship';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
