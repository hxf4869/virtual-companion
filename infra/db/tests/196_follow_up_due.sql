-- W09-S3: due decisions keep the stored plan, defer outside the trigger column,
-- and enqueue at most one live FOLLOW_UP job. The server TimeZone does not
-- move that plan. vc_api cannot run the worker functions. V39 is unchanged.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (19601, 'w09 due owner'),
    (19602, 'w09 due other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (19601, 19610, 'persona-s3', true),
    (19602, 19620, 'persona-other', true);

INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES (
    19601, 19610, 19610, 'w09-s3',
    '19600000-0000-4000-8000-000000000196', 'COMPANION', 'PRESENT', false);
INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
VALUES (
    19601, 19610, '11111111-1111-4111-8111-000000000196', '22222222-2222-4222-8222-000000000196',
    1, 1, 'st:19600000-0000-4000-8000-000000000196:11111111-1111-4111-8111-000000000196:22222222-2222-4222-8222-000000000196:1:1',
    'user', 'w09-due', true, true, true, false, 1);

BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3src', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3src', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status) VALUES
    (19611, 19601, 19610, 'RELATIONSHIP', 'w09 due a', 'ACCEPTED'),
    (19612, 19601, 19610, 'RELATIONSHIP', 'w09 due b', 'ACCEPTED'),
    (19613, 19601, 19610, 'RELATIONSHIP', 'w09 due c', 'ACCEPTED');
INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
    (19601, 19621, 19611, 'st:19600000-0000-4000-8000-000000000196:11111111-1111-4111-8111-000000000196:22222222-2222-4222-8222-000000000196:1:1'),
    (19601, 19622, 19612, 'st:19600000-0000-4000-8000-000000000196:11111111-1111-4111-8111-000000000196:22222222-2222-4222-8222-000000000196:1:1'),
    (19601, 19623, 19613, 'st:19600000-0000-4000-8000-000000000196:11111111-1111-4111-8111-000000000196:22222222-2222-4222-8222-000000000196:1:1');
COMMIT;
RESET ROLE;

CREATE TEMP TABLE w09_due(follow_a bigint, follow_b bigint, follow_c bigint, job_id bigint);
INSERT INTO w09_due VALUES (NULL, NULL, NULL, NULL);
GRANT ALL ON TABLE w09_due TO vc_api, vc_worker;

BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3ins', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3ins', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_ref text := 'st:19600000-0000-4000-8000-000000000196:11111111-1111-4111-8111-000000000196:22222222-2222-4222-8222-000000000196:1:1';
    v_a bigint;
    v_b bigint;
    v_c bigint;
BEGIN
    v_a := vc.insert_follow_up(
        19601, 19610, 19611, v_ref, 1, 'w09 due a',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
    v_b := vc.insert_follow_up(
        19601, 19610, 19612, v_ref, 1, 'w09 due b',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-11-02', '18:30', 'Asia/Shanghai', timestamptz '2026-11-02 18:30:00+08');
    v_c := vc.insert_follow_up(
        19601, 19610, 19613, v_ref, 1, 'w09 due c',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-12-01', '09:00', 'Asia/Shanghai', timestamptz '2026-12-01 09:00:00+08');
    UPDATE w09_due SET follow_a = v_a, follow_b = v_b, follow_c = v_c;
END $$;
COMMIT;
RESET ROLE;

-- No policy: enqueue writes nothing and leaves the stored trigger alone.
BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3off', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3off', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_job bigint;
    v_created boolean;
    v_status text;
    v_trigger timestamptz;
    v_date date;
    v_time text;
    v_zone text;
BEGIN
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19601, (SELECT follow_a FROM w09_due), 'enqueue', NULL);
    SELECT status, event_date, event_time, event_timezone, trigger_at
      INTO v_status, v_date, v_time, v_zone, v_trigger
      FROM vc.follow_up
     WHERE owner_user_id = 19601 AND id = (SELECT follow_a FROM w09_due);
    IF v_job <> 0 OR v_created OR v_status <> 'SCHEDULED'
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS DISTINCT FROM timestamptz '2026-11-02 15:04:00+08' THEN
        RAISE EXCEPTION 'closed policy enqueued or moved the plan';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.work_item
         WHERE owner_user_id = 19601 AND kind = 'FOLLOW_UP'
           AND ref_id = (SELECT follow_a FROM w09_due)) THEN
        RAISE EXCEPTION 'closed policy inserted a job';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3pol', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3pol', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.put_proactive_policy(
    19601, 19610, true, NULL, NULL, NULL, 3, 0, ARRAY['COMPANION'], false);
COMMIT;
RESET ROLE;

-- Defer records the next instant and does not rewrite the event.
BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3def', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3def', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_created boolean;
    v_status text;
    v_date date;
    v_time text;
    v_zone text;
    v_trigger timestamptz;
    v_until timestamptz;
    v_doc jsonb;
BEGIN
    SELECT out_created INTO v_created
      FROM vc.apply_follow_up_due(
          19601, (SELECT follow_a FROM w09_due), 'defer', timestamptz '2026-11-02 18:00:00+08');
    SELECT status, event_date, event_time, event_timezone, trigger_at, deferred_until
      INTO v_status, v_date, v_time, v_zone, v_trigger, v_until
      FROM vc.follow_up
     WHERE owner_user_id = 19601 AND id = (SELECT follow_a FROM w09_due);
    IF v_created OR v_status <> 'DEFERRED'
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS NOT NULL
       OR v_until IS DISTINCT FROM timestamptz '2026-11-02 18:00:00+08' THEN
        RAISE EXCEPTION 'defer rewrote the stored event';
    END IF;
    SELECT vc.export_v2_owner_metadata(19601) INTO v_doc;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_doc->'followUps', '[]'::jsonb)) e
         WHERE e ? 'deferredUntil') THEN
        RAISE EXCEPTION 'export included deferredUntil';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(v_doc->'followUps', '[]'::jsonb)) e
         WHERE e->>'eventId' = 'fu-m-19611'
           AND e->>'status' = 'DEFERRED'
           AND e->>'eventDate' = '2026-11-02') THEN
        RAISE EXCEPTION 'export lost the deferred follow-up plan';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- A different session zone still restores the original absolute trigger.
-- The second enqueue returns the same job.
BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3q', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3q', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_job bigint;
    v_again bigint;
    v_created boolean;
    v_again_created boolean;
    v_status text;
    v_date date;
    v_time text;
    v_zone text;
    v_trigger timestamptz;
    v_until timestamptz;
    v_greeting text;
    v_outcome text;
BEGIN
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19601, (SELECT follow_a FROM w09_due), 'enqueue', NULL);
    SELECT out_job, out_created INTO v_again, v_again_created
      FROM vc.apply_follow_up_due(19601, (SELECT follow_a FROM w09_due), 'enqueue', NULL);
    SELECT status, event_date, event_time, event_timezone, trigger_at, deferred_until
      INTO v_status, v_date, v_time, v_zone, v_trigger, v_until
      FROM vc.follow_up
     WHERE owner_user_id = 19601 AND id = (SELECT follow_a FROM w09_due);
    IF NOT v_created OR v_again_created OR v_job IS NULL OR v_job <> v_again
       OR v_status <> 'SCHEDULED'
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS DISTINCT FROM timestamptz '2026-11-02 15:04:00+08'
       OR v_until IS NOT NULL THEN
        RAISE EXCEPTION 'enqueue did not restore the stored plan once';
    END IF;
    UPDATE w09_due SET job_id = v_job;

    SELECT out_created INTO v_created
      FROM vc.apply_follow_up_due(19601, (SELECT follow_b FROM w09_due), 'silent', NULL);
    SELECT status, event_date, event_time, event_timezone, trigger_at, deferred_until,
           greeting_body, generation_outcome
      INTO v_status, v_date, v_time, v_zone, v_trigger, v_until, v_greeting, v_outcome
      FROM vc.follow_up
     WHERE owner_user_id = 19601 AND id = (SELECT follow_b FROM w09_due);
    IF v_created OR v_status <> 'SILENT'
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '18:30'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS NOT NULL OR v_until IS NOT NULL
       OR v_greeting IS NOT NULL OR v_outcome IS NOT NULL THEN
        RAISE EXCEPTION 'silent rewrote the event or stored a greeting';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.work_item
         WHERE owner_user_id = 19601 AND kind = 'FOLLOW_UP'
           AND ref_id = (SELECT follow_b FROM w09_due)
           AND status <> 'CANCELLED') THEN
        RAISE EXCEPTION 'silent inserted a job';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The counted job is on the other follow-up, inside the Shanghai day of the
-- evaluation instant and outside that instant's Kiritimati day.
INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status, created_at)
VALUES (
    19601, nextval('vc.work_item_id_seq'), 'FOLLOW_UP',
    (SELECT follow_c FROM w09_due), 'DONE', timestamptz '2026-11-02 12:00:00+08');

BEGIN;
SET LOCAL TIME ZONE 'Pacific/Kiritimati';
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_sent integer;
    v_rows integer;
BEGIN
    SELECT count(*)::integer, max(out_sent_today)
      INTO v_rows, v_sent
      FROM vc.list_due_follow_ups(timestamptz '2026-11-02 23:00:00+08')
     WHERE out_id = (SELECT follow_a FROM w09_due);
    IF v_rows <> 1 OR v_sent IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'user-day count followed the session zone (% rows, sent %)', v_rows, v_sent;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19602, 'w09s3other', encode(vc.hmac(convert_to('vc-owner-binding-v1|19602|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    PERFORM vc.apply_follow_up_due(19601, (SELECT follow_a FROM w09_due), 'silent', NULL);
    RAISE EXCEPTION 'other owner applied a follow-up';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN
        RAISE;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19601, 'w09s3api', encode(vc.hmac(convert_to('vc-owner-binding-v1|19601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3api', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.list_follow_up_sync_targets();
        RAISE EXCEPTION 'vc_api listed sync targets';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    BEGIN
        PERFORM vc.list_due_follow_ups(timestamptz '2026-11-02 23:00:00+08');
        RAISE EXCEPTION 'vc_api listed due follow-ups';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
    BEGIN
        PERFORM vc.apply_follow_up_due(19601, (SELECT follow_a FROM w09_due), 'leave', NULL);
        RAISE EXCEPTION 'vc_api applied a follow-up';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19602, 'w09s3see', encode(vc.hmac(convert_to('vc-owner-binding-v1|19602|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s3see', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*)::integer INTO n FROM vc.follow_up WHERE owner_user_id = 19601;
    IF n <> 0 THEN
        RAISE EXCEPTION 'other owner saw % follow-ups', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'vc.reminder'::regclass
           AND pg_get_constraintdef(oid) LIKE '%DEFERRED%') THEN
        RAISE EXCEPTION 'V39 reminder status was extended';
    END IF;
END $$;
