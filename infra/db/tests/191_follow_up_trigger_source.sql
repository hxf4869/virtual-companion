-- W09-S2: a triggerable follow-up without a memory and a current source is
-- rejected. A forgotten memory and a source that is no longer present are
-- rejected too. Cancelling a follow-up keeps the row; a later scheduled insert
-- returns that same row and does not restore its trigger or its job.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES (19101, 'w09 follow-up source');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (19101, 19110, 'persona-s2', true);

INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES (
    19101, 19110, 19110, 'w09-s2',
    '19100000-0000-4000-8000-000000000191', 'COMPANION', 'PRESENT', false);

INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
VALUES
    (19101, 19110, '11111111-1111-4111-8111-0000000000a1', '22222222-2222-4222-8222-0000000000a1',
     1, 1, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000a1:22222222-2222-4222-8222-0000000000a1:1:1',
     'user', 'w09-a', true, true, true, false, 1),
    (19101, 19110, '11111111-1111-4111-8111-0000000000b1', '22222222-2222-4222-8222-0000000000b1',
     1, 1, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000b1:22222222-2222-4222-8222-0000000000b1:1:1',
     'user', 'w09-b', true, true, true, false, 2),
    (19101, 19110, '11111111-1111-4111-8111-0000000000c1', '22222222-2222-4222-8222-0000000000c1',
     1, 1, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000c1:22222222-2222-4222-8222-0000000000c1:1:1',
     'user', 'w09-c', true, true, true, false, 3),
    (19101, 19110, '11111111-1111-4111-8111-0000000000d1', '22222222-2222-4222-8222-0000000000d1',
     1, 1, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000d1:22222222-2222-4222-8222-0000000000d1:1:1',
     'user', 'w09-d', true, true, true, false, 4);

BEGIN;
SELECT vc.set_owner_context(19101, 'w09s2', encode(vc.hmac(convert_to('vc-owner-binding-v1|19101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status) VALUES
    (19111, 19101, 19110, 'RELATIONSHIP', 'w09 memory a', 'ACCEPTED'),
    (19112, 19101, 19110, 'RELATIONSHIP', 'w09 memory b', 'ACCEPTED'),
    (19113, 19101, 19110, 'RELATIONSHIP', 'w09 memory c', 'ACCEPTED'),
    (19114, 19101, 19110, 'RELATIONSHIP', 'w09 memory d', 'ACCEPTED');
INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
    (19101, 19121, 19111, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000a1:22222222-2222-4222-8222-0000000000a1:1:1'),
    (19101, 19122, 19112, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000b1:22222222-2222-4222-8222-0000000000b1:1:1'),
    (19101, 19123, 19113, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000c1:22222222-2222-4222-8222-0000000000c1:1:1'),
    (19101, 19124, 19114, 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000d1:22222222-2222-4222-8222-0000000000d1:1:1');
COMMIT;
RESET ROLE;

-- Forgetting a memory suppresses its source, and that job sync asserts the
-- trusted owner. The other two updates do not enter that path.
BEGIN;
SELECT vc.set_owner_context(19101, 'w09s2del', encode(vc.hmac(convert_to('vc-owner-binding-v1|19101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s2del', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
UPDATE vc.memory_item SET deleted_at = clock_timestamp()
 WHERE owner_user_id = 19101 AND id = 19112;
COMMIT;
RESET ROLE;
UPDATE vc.memory_item SET source_invalidated_at = clock_timestamp()
 WHERE owner_user_id = 19101 AND id = 19113;
UPDATE vc.st_message_source SET present = false
 WHERE owner_user_id = 19101
   AND source_ref = 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000d1:22222222-2222-4222-8222-0000000000d1:1:1';

CREATE TEMP TABLE w09_s2_ids (job_id bigint);
INSERT INTO w09_s2_ids VALUES (NULL);
GRANT ALL ON TABLE w09_s2_ids TO vc_api;

DO $$
BEGIN
    BEGIN
        INSERT INTO vc.follow_up(
            owner_user_id, relationship_id, body, status, normalization_status,
            time_precision, reminder_rule_confirmed, event_date, event_time, event_timezone,
            trigger_at, event_id)
        VALUES (
            19101, 19110, 'no source', 'SCHEDULED', 'explicit_date',
            'minute', false, DATE '2026-11-02', '15:04', 'Asia/Shanghai',
            timestamptz '2026-11-02 15:04:00+08', 'fu-unsourced');
        RAISE EXCEPTION 'unsourced trigger unexpectedly succeeded';
    EXCEPTION WHEN check_violation THEN
        IF SQLERRM NOT LIKE '%follow_up_trigger_source%' THEN
            RAISE EXCEPTION 'unsourced trigger rejected for the wrong reason: %', SQLERRM;
        END IF;
    END;
END $$;

BEGIN;
SELECT vc.set_owner_context(19101, 'w09s2b', encode(vc.hmac(convert_to('vc-owner-binding-v1|19101|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s2b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
    v_again bigint;
    v_job bigint;
    v_status text;
    v_trigger timestamptz;
    v_ref text := 'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000a1:22222222-2222-4222-8222-0000000000a1:1:1';
BEGIN
    BEGIN
        PERFORM vc.insert_follow_up(
            19101, 19110, NULL, NULL, NULL, 'no source function',
            'SCHEDULED', 'explicit_date', 'minute', false,
            DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
        RAISE EXCEPTION 'function accepted a triggerable row without a source';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: triggerable row requires a verified memory source' THEN
            RAISE;
        END IF;
    END;

    v_id := vc.insert_follow_up(
        19101, 19110, 19111, v_ref, 1, 'w09-source-body',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
    IF v_id IS NULL OR (SELECT event_id FROM vc.follow_up WHERE id = v_id) <> 'fu-m-19111' THEN
        RAISE EXCEPTION 'verified memory did not create a stable follow-up';
    END IF;
    v_job := vc.enqueue_follow_up(19101, v_id);
    IF v_job IS NULL THEN
        RAISE EXCEPTION 'scheduled follow-up did not enqueue';
    END IF;
    UPDATE w09_s2_ids SET job_id = v_job;
    IF NOT vc.cancel_follow_up(19101, v_id) THEN
        RAISE EXCEPTION 'cancel of own follow-up failed';
    END IF;

    v_again := vc.insert_follow_up(
        19101, 19110, 19111, v_ref, 1, 'late write',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-12-01', '09:00', 'Asia/Shanghai', timestamptz '2026-12-01 09:00:00+08');
    SELECT status, trigger_at INTO v_status, v_trigger FROM vc.follow_up WHERE id = v_again;
    IF v_again IS DISTINCT FROM v_id OR v_status IS DISTINCT FROM 'CANCELLED' OR v_trigger IS NOT NULL THEN
        RAISE EXCEPTION 'late insert revived the cancelled follow-up (% / %)', v_status, v_trigger;
    END IF;
    IF (SELECT event_date FROM vc.follow_up WHERE id = v_id) IS DISTINCT FROM DATE '2026-11-02' THEN
        RAISE EXCEPTION 'late insert rewrote the saved event date';
    END IF;
    BEGIN
        PERFORM vc.enqueue_follow_up(19101, v_id);
        RAISE EXCEPTION 'cancelled follow-up was queued again';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: only a scheduled follow-up can be queued' THEN
            RAISE;
        END IF;
    END;

    BEGIN
        PERFORM vc.insert_follow_up(
            19101, 19110, 19112,
            'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000b1:22222222-2222-4222-8222-0000000000b1:1:1',
            1, 'forgotten',
            'SCHEDULED', 'explicit_date', 'minute', false,
            DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
        RAISE EXCEPTION 'forgotten memory was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: memory is not a current published source' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.insert_follow_up(
            19101, 19110, 19113,
            'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000c1:22222222-2222-4222-8222-0000000000c1:1:1',
            1, 'invalidated',
            'SCHEDULED', 'explicit_date', 'minute', false,
            DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
        RAISE EXCEPTION 'invalidated memory was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: memory is not a current published source' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        PERFORM vc.insert_follow_up(
            19101, 19110, 19114,
            'st:19100000-0000-4000-8000-000000000191:11111111-1111-4111-8111-0000000000d1:22222222-2222-4222-8222-0000000000d1:1:1',
            1, 'absent source',
            'SCHEDULED', 'explicit_date', 'minute', false,
            DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
        RAISE EXCEPTION 'absent source was accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'follow_up: source is not current' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF (SELECT status FROM vc.work_item WHERE owner_user_id = 19101 AND id = (SELECT job_id FROM w09_s2_ids)) IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'committed follow-up job was restored';
    END IF;
    IF (SELECT status FROM vc.follow_up WHERE owner_user_id = 19101 AND memory_item_id = 19111) IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION 'committed follow-up was restored';
    END IF;
END $$;

INSERT INTO vc.account_deletion_intent(account_id, username_digest, status, st_status)
VALUES (19101, lpad('191', 64, '0'), 'REQUESTED', 'COMPLETED');
DELETE FROM vc.vc_user WHERE id = 19101;
