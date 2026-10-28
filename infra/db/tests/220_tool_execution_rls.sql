-- W11-1: tool execution commits before the business row, and a V39 reminder
-- gains a terminal cancel. Other owners cannot see either. The export keeps
-- the existing top-level keys and puts the new reminder fields inside reminders.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (22001, 'w11 tool owner'),
    (22002, 'w11 tool other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (22001, 10, 'persona-a', true),
    (22001, 11, 'persona-b', true),
    (22002, 20, 'persona-c', true);
UPDATE vc.relationship SET reminders_allowed = true WHERE owner_user_id = 22001 AND id = 10;
INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES
    (22001, 22010, 10, 'w11', '22000000-0000-4000-8000-000000002201', 'COMPANION', 'PRESENT', false),
    (22001, 22011, 11, 'w11b', '22000000-0000-4000-8000-000000002202', 'COMPANION', 'PRESENT', false);
INSERT INTO vc.follow_up(
    owner_user_id, relationship_id, memory_item_id, source_ref, body, status, normalization_status,
    time_precision, reminder_rule_confirmed, event_date, event_time, event_timezone, trigger_at, event_id)
VALUES
    (22001, 10, 22011, 'st:synthetic', 'bound', 'SCHEDULED', 'explicit_date', 'minute', false,
     DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 07:04:00+00', 'evt-bound'),
    (22001, 10, 22012, 'st:synthetic', 'unclear', 'NEEDS_CLARIFICATION', 'needs_clarification', 'date', false,
     DATE '2026-11-02', NULL, NULL, NULL, 'evt-unclear'),
    (22001, 11, 22013, 'st:synthetic', 'other', 'SCHEDULED', 'explicit_date', 'minute', false,
     DATE '2026-11-03', '09:00', 'Asia/Shanghai', timestamptz '2026-11-03 01:00:00+00', 'evt-other'),
    (22002, 20, 22014, 'st:synthetic', 'bob', 'SCHEDULED', 'explicit_date', 'minute', false,
     DATE '2026-11-04', '10:00', 'Asia/Shanghai', timestamptz '2026-11-04 02:00:00+00', 'evt-bob');

CREATE TEMP TABLE w11_ids (
    phase_exec bigint,
    reminder_id bigint,
    bound_follow bigint,
    other_follow bigint,
    unclear_follow bigint,
    last_exec bigint,
    last_fresh boolean,
    last_result jsonb,
    cancel_stamp timestamptz,
    follow_stamp timestamptz,
    create_payload jsonb
);
INSERT INTO w11_ids(create_payload, bound_follow, other_follow, unclear_follow)
SELECT jsonb_build_object(
        'tool', 'manage_reminder',
        'arguments', jsonb_build_object('action', 'create', 'text', 'buy milk', 'remindAt', '2026-11-02T15:04:00Z'),
        'assistant', false,
        'forbidden', false),
    (SELECT id FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-bound'),
    (SELECT id FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-other'),
    (SELECT id FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-unclear');
GRANT ALL ON TABLE w11_ids TO vc_api, vc_worker;

CREATE FUNCTION pg_temp.w11_owner(p_owner bigint, p_label text) RETURNS void
    LANGUAGE plpgsql AS $fn$
BEGIN
    PERFORM vc.set_owner_context(p_owner, p_label, encode(vc.hmac(convert_to(
        'vc-owner-binding-v1|' || p_owner::text || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || p_label,
        'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
END $fn$;

CREATE FUNCTION pg_temp.w11_counts(p_exec integer, p_rem integer) RETURNS void
    LANGUAGE plpgsql AS $fn$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM vc.tool_execution WHERE owner_user_id = 22001;
    IF n <> p_exec THEN RAISE EXCEPTION 'executions % want %', n, p_exec; END IF;
    SELECT count(*) INTO n FROM vc.reminder WHERE owner_user_id = 22001;
    IF n <> p_rem THEN RAISE EXCEPTION 'reminders % want %', n, p_rem; END IF;
END $fn$;

CREATE FUNCTION pg_temp.w11_apply(
    p_key text,
    p_payload jsonb,
    p_purpose text,
    p_revision text,
    p_step integer,
    p_timeout integer,
    p_token integer,
    p_status text,
    p_code text,
    p_tool text
) RETURNS void
    LANGUAGE plpgsql AS $fn$
DECLARE
    v_id bigint;
    v_fresh boolean;
    r record;
BEGIN
    SELECT out_id, out_fresh INTO v_id, v_fresh
      FROM vc.begin_tool_execution(
          22001, '22000000-0000-4000-8000-000000002201', p_key, p_payload,
          p_purpose, p_revision, p_step, p_timeout, p_token);
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'begin returned no id for %', p_key;
    END IF;
    SELECT * INTO r FROM vc.apply_tool_execution(22001, v_id);
    IF r.out_status IS DISTINCT FROM p_status
       OR r.out_failure_code IS DISTINCT FROM p_code
       OR r.out_tool IS DISTINCT FROM p_tool
       OR r.out_id IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'key % got tool=% status=% code=% want tool=% status=% code=%',
            p_key, r.out_tool, r.out_status, r.out_failure_code, p_tool, p_status, p_code;
    END IF;
    UPDATE w11_ids SET last_exec = v_id, last_fresh = v_fresh, last_result = r.out_result;
END $fn$;

CREATE FUNCTION pg_temp.w11_query_ok() RETURNS void
    LANGUAGE plpgsql AS $fn$
DECLARE
    n integer;
    got text;
    bound text;
    other text;
    unclear text;
BEGIN
    n := jsonb_array_length(COALESCE((SELECT last_result FROM w11_ids)->'followUps', '[]'::jsonb));
    got := (SELECT last_result FROM w11_ids)->'followUps'->0->>'id';
    bound := (SELECT bound_follow::text FROM w11_ids);
    other := (SELECT other_follow::text FROM w11_ids);
    unclear := (SELECT unclear_follow::text FROM w11_ids);
    IF n <> 1 OR got IS DISTINCT FROM bound OR got = other OR got = unclear
       OR (SELECT last_result FROM w11_ids)->'followUps'->0->>'status' IS DISTINCT FROM 'SCHEDULED'
       OR (SELECT last_result::text FROM w11_ids) LIKE '%evt-%' THEN
        RAISE EXCEPTION 'query result %', (SELECT last_result FROM w11_ids);
    END IF;
END $fn$;

-- Runtime cannot insert an execution. The caught error must not leave a row.
BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11deny');
SET LOCAL ROLE vc_api;
DO $do$
BEGIN
    BEGIN
        INSERT INTO vc.tool_execution(owner_user_id, idempotency_key, chat_identity, tool_name, status)
        VALUES (22001, 'direct-insert-01', '22000000-0000-4000-8000-000000002201', 'rejected', 'RUNNING');
        RAISE EXCEPTION 'direct insert unexpectedly succeeded';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $do$;
COMMIT;
RESET ROLE;

DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.tool_execution WHERE idempotency_key = 'direct-insert-01') THEN
        RAISE EXCEPTION 'direct insert left a row';
    END IF;
END $do$;

-- Commit the RUNNING execution, roll apply back, and prove the business row
-- was not committed with it. A later committed apply then creates the reminder.
BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11begin');
SET LOCAL ROLE vc_api;
DO $do$
DECLARE
    v_id bigint;
    v_status text;
    v_fresh boolean;
BEGIN
    SELECT out_id, out_status, out_fresh INTO v_id, v_status, v_fresh
      FROM vc.begin_tool_execution(
          22001, '22000000-0000-4000-8000-000000002201', 'create-key-01',
          (SELECT create_payload FROM w11_ids), 'tool', 'rev-1', 1, 1000, 100);
    IF v_id IS NULL OR v_status <> 'RUNNING' OR v_fresh IS NOT TRUE THEN
        RAISE EXCEPTION 'begin % % %', v_id, v_status, v_fresh;
    END IF;
    UPDATE w11_ids SET phase_exec = v_id;
END $do$;
COMMIT;
RESET ROLE;

SELECT pg_temp.w11_counts(1, 0);
DO $do$
BEGIN
    IF (SELECT status FROM vc.tool_execution WHERE owner_user_id = 22001 AND id = (SELECT phase_exec FROM w11_ids))
       IS DISTINCT FROM 'RUNNING'
       OR (SELECT finished_at IS NULL FROM vc.tool_execution WHERE owner_user_id = 22001 AND id = (SELECT phase_exec FROM w11_ids))
          IS NOT TRUE
       OR (SELECT purpose FROM vc.tool_execution WHERE owner_user_id = 22001 AND id = (SELECT phase_exec FROM w11_ids))
          IS DISTINCT FROM 'tool'
       OR (SELECT step_count FROM vc.tool_execution WHERE owner_user_id = 22001 AND id = (SELECT phase_exec FROM w11_ids))
          IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'running execution was not committed intact';
    END IF;
END $do$;

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11roll');
SET LOCAL ROLE vc_api;
SELECT * FROM vc.apply_tool_execution(22001, (SELECT phase_exec FROM w11_ids));
ROLLBACK;
RESET ROLE;

SELECT pg_temp.w11_counts(1, 0);
DO $do$
BEGIN
    IF (SELECT status FROM vc.tool_execution WHERE owner_user_id = 22001 AND id = (SELECT phase_exec FROM w11_ids))
       IS DISTINCT FROM 'RUNNING' THEN
        RAISE EXCEPTION 'rolled-back apply changed the committed execution';
    END IF;
END $do$;

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11apply');
SET LOCAL ROLE vc_api;
DO $do$
DECLARE
    r record;
BEGIN
    SELECT * INTO r FROM vc.apply_tool_execution(22001, (SELECT phase_exec FROM w11_ids));
    IF r.out_status <> 'SUCCEEDED' OR r.out_failure_code IS NOT NULL OR r.out_tool <> 'manage_reminder'
       OR r.out_result->>'status' <> 'ACTIVE' OR r.out_result->>'reminderId' IS NULL THEN
        RAISE EXCEPTION 'apply result %', r.out_result;
    END IF;
END $do$;
COMMIT;
RESET ROLE;

SELECT pg_temp.w11_counts(1, 1);
DO $do$
BEGIN
    IF (SELECT status FROM vc.tool_execution WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01')
       IS DISTINCT FROM 'SUCCEEDED'
       OR (SELECT remind_at FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01')
          IS DISTINCT FROM timestamptz '2026-11-02 15:04:00+00'
       OR (SELECT execution_id FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01')
          IS DISTINCT FROM (SELECT phase_exec FROM w11_ids)
       OR (SELECT count(*) FROM vc.tool_execution WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01')
          <> 1 THEN
        RAISE EXCEPTION 'committed create did not keep one reminder for the execution';
    END IF;
END $do$;
UPDATE w11_ids SET reminder_id = (
    SELECT id FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01');

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11replay');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'create-key-01', (SELECT create_payload FROM w11_ids),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
DO $do$
BEGIN
    IF (SELECT last_fresh FROM w11_ids) IS NOT FALSE
       OR (SELECT last_exec FROM w11_ids) IS DISTINCT FROM (SELECT phase_exec FROM w11_ids) THEN
        RAISE EXCEPTION 'replay created another execution';
    END IF;
END $do$;
COMMIT;
RESET ROLE;
SELECT pg_temp.w11_counts(1, 1);

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11batch');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'assistant-text-01',
    jsonb_build_object(
        'tool', '', 'arguments', '{}'::jsonb, 'assistant', true, 'forbidden', false,
        'role', 'assistant', 'content', 'remind me tomorrow at the office',
        'utterance', 'remind me tomorrow at the office'),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'ASSISTANT_TEXT', 'assistant_text');
SELECT pg_temp.w11_apply(
    'date-only-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object('action', 'create', 'text', 'only date', 'remindAt', '2026-11-02')),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'DATE_ONLY', 'manage_reminder');
SELECT pg_temp.w11_apply(
    'missing-zone-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object('action', 'create', 'text', 'no zone', 'remindAt', '2026-11-02T15:04:00')),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'MISSING_TIMEZONE', 'manage_reminder');
SELECT pg_temp.w11_apply(
    'midnight-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object('action', 'create', 'text', 'midnight', 'remindAt', '2026-11-02T00:00:00Z')),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
SELECT pg_temp.w11_apply(
    'forbidden-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'create', 'text', 'x', 'remindAt', '2026-11-02T15:04:00Z', 'relationshipId', '11')),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'FORBIDDEN_RELATIONSHIP', 'rejected');
SELECT pg_temp.w11_apply(
    'unknown-key-01',
    jsonb_build_object('tool', 'not_a_tool', 'arguments', '{}'::jsonb, 'assistant', false, 'forbidden', false),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'UNKNOWN_TOOL', 'unknown');
SELECT pg_temp.w11_apply(
    'bounds-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object('action', 'create', 'text', 'bounds', 'remindAt', '2026-11-02T15:04:00Z')),
    NULL::text, NULL::text, 0, NULL::integer, NULL::integer,
    'FAILED', 'INVALID_BOUNDS', 'manage_reminder');
SELECT pg_temp.w11_apply(
    'query-key-01',
    jsonb_build_object(
        'tool', 'query_scheduled_follow_ups', 'arguments', '{}'::jsonb, 'assistant', false, 'forbidden', false),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'query_scheduled_follow_ups');
SELECT pg_temp.w11_query_ok();
COMMIT;
RESET ROLE;

SELECT pg_temp.w11_counts(9, 2);
DO $do$
DECLARE
    payload jsonb;
BEGIN
    SELECT e.payload INTO payload
      FROM vc.tool_execution e
     WHERE e.owner_user_id = 22001 AND e.idempotency_key = 'assistant-text-01';
    IF payload ? 'content' OR payload ? 'utterance' OR payload ? 'role' OR payload ? 'text'
       OR payload::text LIKE '%remind me tomorrow at the office%' THEN
        RAISE EXCEPTION 'assistant dialogue stored %', payload;
    END IF;
    IF (SELECT remind_at FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'midnight-key-01')
       IS DISTINCT FROM timestamptz '2026-11-02 00:00:00+00' THEN
        RAISE EXCEPTION 'explicit midnight was not stored at that instant';
    END IF;
    IF (SELECT step_count FROM vc.tool_execution WHERE owner_user_id = 22001 AND idempotency_key = 'bounds-key-01')
       IS DISTINCT FROM 0
       OR (SELECT count(*) FROM vc.reminder WHERE owner_user_id = 22001 AND text = 'only date') <> 0
       OR (SELECT count(*) FROM vc.reminder WHERE owner_user_id = 22001 AND text = 'bounds') <> 0 THEN
        RAISE EXCEPTION 'failed execution created a reminder or dropped the step';
    END IF;
END $do$;

UPDATE vc.relationship SET reminders_allowed = false WHERE owner_user_id = 22001 AND id = 10;

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11off');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'disabled-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object('action', 'create', 'text', 'nope', 'remindAt', '2026-11-02')),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'REMINDERS_DISABLED', 'manage_reminder');
SELECT pg_temp.w11_apply(
    'query-while-off-01',
    jsonb_build_object(
        'tool', 'query_scheduled_follow_ups', 'arguments', '{}'::jsonb, 'assistant', false, 'forbidden', false),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'query_scheduled_follow_ups');
SELECT pg_temp.w11_query_ok();
COMMIT;
RESET ROLE;
SELECT pg_temp.w11_counts(11, 2);

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11cancel');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'cancel-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'cancel', 'target', 'reminder',
            'reminderId', (SELECT reminder_id::text FROM w11_ids))),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
COMMIT;
RESET ROLE;

UPDATE w11_ids SET cancel_stamp = (
    SELECT cancelled_at FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01');
DO $do$
BEGIN
    IF (SELECT cancel_stamp FROM w11_ids) IS NULL
       OR (SELECT status FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01')
          IS DISTINCT FROM 'CANCELLED'
       OR (SELECT count(*) FROM vc.reminder WHERE owner_user_id = 22001) <> 2 THEN
        RAISE EXCEPTION 'cancel deleted the reminder or did not finish';
    END IF;
END $do$;

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11cancel2');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'cancel-key-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'cancel', 'target', 'reminder',
            'reminderId', (SELECT reminder_id::text FROM w11_ids))),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
DO $do$
BEGIN
    IF (SELECT last_fresh FROM w11_ids) IS NOT FALSE THEN
        RAISE EXCEPTION 'repeat cancel allocated a new execution';
    END IF;
END $do$;
SELECT pg_temp.w11_apply(
    'cancel-key-02',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'cancel', 'target', 'reminder',
            'reminderId', (SELECT reminder_id::text FROM w11_ids))),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
COMMIT;
RESET ROLE;

DO $do$
BEGIN
    IF (SELECT cancelled_at FROM vc.reminder WHERE owner_user_id = 22001 AND idempotency_key = 'create-key-01')
       IS DISTINCT FROM (SELECT cancel_stamp FROM w11_ids)
       OR (SELECT count(*) FROM vc.tool_execution WHERE owner_user_id = 22001 AND idempotency_key = 'cancel-key-01') <> 1
       OR (SELECT count(*) FROM vc.reminder WHERE owner_user_id = 22001 AND status = 'CANCELLED') <> 1 THEN
        RAISE EXCEPTION 'repeat cancel changed the terminal reminder';
    END IF;
END $do$;
SELECT pg_temp.w11_counts(13, 2);

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11follow');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'cancel-other-rel-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'cancel', 'target', 'follow_up',
            'followUpId', (SELECT other_follow::text FROM w11_ids))),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'FAILED', 'NOT_FOUND', 'manage_reminder');
SELECT pg_temp.w11_apply(
    'cancel-follow-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'cancel', 'target', 'follow_up',
            'followUpId', (SELECT bound_follow::text FROM w11_ids))),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
COMMIT;
RESET ROLE;

UPDATE w11_ids SET follow_stamp = (
    SELECT cancelled_at FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-bound');

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11follow2');
SET LOCAL ROLE vc_api;
SELECT pg_temp.w11_apply(
    'cancel-follow-01',
    jsonb_build_object(
        'tool', 'manage_reminder', 'assistant', false, 'forbidden', false,
        'arguments', jsonb_build_object(
            'action', 'cancel', 'target', 'follow_up',
            'followUpId', (SELECT bound_follow::text FROM w11_ids))),
    NULL::text, NULL::text, NULL::integer, NULL::integer, NULL::integer,
    'SUCCEEDED', NULL::text, 'manage_reminder');
DO $do$
BEGIN
    IF (SELECT last_fresh FROM w11_ids) IS NOT FALSE THEN
        RAISE EXCEPTION 'repeat follow-up cancel allocated a new execution';
    END IF;
END $do$;
COMMIT;
RESET ROLE;

DO $do$
BEGIN
    IF (SELECT status FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-other') IS DISTINCT FROM 'SCHEDULED'
       OR (SELECT status FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-bound') IS DISTINCT FROM 'CANCELLED'
       OR (SELECT trigger_at IS NULL FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-bound') IS NOT TRUE
       OR (SELECT cancelled_at FROM vc.follow_up WHERE owner_user_id = 22001 AND event_id = 'evt-bound')
          IS DISTINCT FROM (SELECT follow_stamp FROM w11_ids)
       OR (SELECT follow_stamp FROM w11_ids) IS NULL THEN
        RAISE EXCEPTION 'follow-up cancel was not terminal';
    END IF;
END $do$;
SELECT pg_temp.w11_counts(15, 2);

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11export');
SET LOCAL ROLE vc_api;
SELECT vc.create_reminder(22001, 10, 'legacy reminder', timestamptz '2026-11-02 08:00:00+00', 'NONE');
DO $do$
DECLARE
    doc jsonb;
    keys jsonb;
    item jsonb;
    got jsonb;
    expected jsonb := '["bindings","capturedAt","consents","evidence","extractionResults","followUps","instances","memoryAutoSave","memoryTimes","proactivePolicies","reminders","sources","sourceTimes","storyRuns","summaries","summarySources","tasks"]'::jsonb;
    reminder_keys jsonb := '["cancelledAt","executionId","idempotencyKey","recurrence","relationshipId","remindAt","reminderId","status","text"]'::jsonb;
    n integer := 0;
BEGIN
    doc := vc.export_v2_owner_metadata(22001);
    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO keys FROM jsonb_object_keys(doc) AS k;
    IF keys IS DISTINCT FROM (
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_array_elements_text(expected) AS k
    ) THEN
        RAISE EXCEPTION 'export keys changed: %', keys;
    END IF;
    IF jsonb_array_length(doc->'reminders') <> 3 THEN
        RAISE EXCEPTION 'export reminders %', doc->'reminders';
    END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(doc->'reminders') AS t(value)
    LOOP
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO got FROM jsonb_object_keys(item) AS k;
        IF got IS DISTINCT FROM (
            SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_array_elements_text(reminder_keys) AS k
        ) THEN
            RAISE EXCEPTION 'reminder keys %', got;
        END IF;
        n := n + 1;
        IF item->>'text' = 'legacy reminder' THEN
            IF item->'idempotencyKey' <> 'null'::jsonb OR item->'executionId' <> 'null'::jsonb
               OR item->'cancelledAt' <> 'null'::jsonb THEN
                RAISE EXCEPTION 'legacy reminder export %', item;
            END IF;
        ELSIF item->>'text' = 'midnight' THEN
            IF item->>'idempotencyKey' <> 'midnight-key-01' OR item->>'executionId' IS NULL
               OR item->'cancelledAt' <> 'null'::jsonb OR item->>'status' <> 'ACTIVE' THEN
                RAISE EXCEPTION 'midnight export %', item;
            END IF;
        ELSIF item->>'text' = 'buy milk' THEN
            IF item->>'idempotencyKey' <> 'create-key-01'
               OR item->>'executionId' IS DISTINCT FROM (SELECT phase_exec::text FROM w11_ids)
               OR item->>'status' <> 'CANCELLED' OR item->>'cancelledAt' IS NULL THEN
                RAISE EXCEPTION 'cancelled reminder export %', item;
            END IF;
        ELSE
            RAISE EXCEPTION 'unexpected reminder %', item->>'text';
        END IF;
    END LOOP;
    IF n <> 3 THEN
        RAISE EXCEPTION 'reminder loop %', n;
    END IF;
    BEGIN
        PERFORM vc.update_reminder(
            22001, (SELECT reminder_id FROM w11_ids),
            'buy milk', timestamptz '2026-11-02 15:04:00+00', 'NONE', 'ACTIVE');
        RAISE EXCEPTION 'update of a cancelled reminder unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'update_reminder: cancelled reminder is terminal' THEN
            RAISE;
        END IF;
    END;
END $do$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT pg_temp.w11_owner(22002, 'w11other');
SET LOCAL ROLE vc_api;
DO $do$
DECLARE
    n integer;
    doc jsonb;
    keys jsonb;
    expected jsonb := '["bindings","capturedAt","consents","evidence","extractionResults","followUps","instances","memoryAutoSave","memoryTimes","proactivePolicies","reminders","sources","sourceTimes","storyRuns","summaries","summarySources","tasks"]'::jsonb;
BEGIN
    SELECT count(*) INTO n FROM vc.tool_execution;
    IF n <> 0 THEN RAISE EXCEPTION 'cross owner executions %', n; END IF;
    SELECT count(*) INTO n FROM vc.list_reminders(22002, NULL, 0, 50);
    IF n <> 0 THEN RAISE EXCEPTION 'cross owner reminders %', n; END IF;
    doc := vc.export_v2_owner_metadata(22002);
    SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO keys FROM jsonb_object_keys(doc) AS k;
    IF keys IS DISTINCT FROM (
        SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) FROM jsonb_array_elements_text(expected) AS k
    ) THEN
        RAISE EXCEPTION 'other export keys %', keys;
    END IF;
    IF doc->'reminders' <> '[]'::jsonb
       OR doc::text LIKE '%buy milk%'
       OR doc::text LIKE '%legacy reminder%'
       OR doc::text LIKE '%midnight%' THEN
        RAISE EXCEPTION 'other owner export leaked reminders %', doc->'reminders';
    END IF;
END $do$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $do$
BEGIN
    IF (SELECT count(*) FROM vc.tool_execution) <> 0 THEN
        RAISE EXCEPTION 'missing owner context leaked executions';
    END IF;
END $do$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11table');
SET LOCAL ROLE vc_api;
DO $do$
DECLARE
    n integer;
BEGIN
    BEGIN
        SELECT count(*) INTO n FROM vc.reminder;
        RAISE EXCEPTION 'reminder select unexpectedly succeeded (%)', n;
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;
END $do$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT pg_temp.w11_owner(22001, 'w11bad');
SET LOCAL ROLE vc_api;
DO $do$
DECLARE
    v bigint;
BEGIN
    BEGIN
        SELECT out_id INTO v FROM vc.begin_tool_execution(
            22001, '22000000-0000-4000-8000-000000002201', 'short', '{}'::jsonb,
            NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'short key unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'tool_execution: idempotency_key is invalid' THEN
            RAISE;
        END IF;
    END;
    BEGIN
        SELECT out_id INTO v FROM vc.begin_tool_execution(
            22001, 'not-a-uuid', 'invalid-chat-01', '{}'::jsonb,
            NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'bad chat unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'tool_execution: chat_identity is invalid' THEN
            RAISE;
        END IF;
    END;
END $do$;
COMMIT;
RESET ROLE;

DO $do$
BEGIN
    IF EXISTS (
        SELECT 1 FROM vc.tool_execution
         WHERE idempotency_key IN ('short', 'invalid-chat-01')) THEN
        RAISE EXCEPTION 'invalid call inserted an execution';
    END IF;
END $do$;
SELECT pg_temp.w11_counts(15, 3);

DO $do$
DECLARE
    v_exec bigint;
    n integer;
BEGIN
    INSERT INTO vc.vc_user(id, display_name) VALUES (22003, 'w11 delete');
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (22003, 30, 'persona-d', true);
    INSERT INTO vc.tool_execution(
        owner_user_id, idempotency_key, chat_identity, tool_name, status, finished_at)
    VALUES (
        22003, 'delete-key-01', '22000000-0000-4000-8000-000000002203',
        'manage_reminder', 'SUCCEEDED', clock_timestamp())
    RETURNING id INTO v_exec;
    INSERT INTO vc.reminder(
        owner_user_id, id, relationship_id, text, remind_at, status, idempotency_key, execution_id)
    VALUES (
        22003, 1, 30, 'gone', timestamptz '2026-11-02 00:00:00+00', 'ACTIVE', 'delete-key-01', v_exec);
    DELETE FROM vc.vc_user WHERE id = 22003;
    SELECT count(*) INTO n FROM vc.vc_user WHERE id = 22003;
    IF n <> 0
       OR EXISTS (SELECT 1 FROM vc.tool_execution WHERE owner_user_id = 22003)
       OR EXISTS (SELECT 1 FROM vc.reminder WHERE owner_user_id = 22003) THEN
        RAISE EXCEPTION 'account delete left tool or reminder rows';
    END IF;
END $do$;
SELECT pg_temp.w11_counts(15, 3);
