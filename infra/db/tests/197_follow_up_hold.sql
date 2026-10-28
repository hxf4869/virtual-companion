-- W09-S5: a not-generated follow-up waits and can be queued again. Only a
-- PENDING or CLAIMED job blocks the next one. A closed policy does not spend
-- a wait. Three waits then become SILENT. A repeated greeting and a repeated
-- cost hold do not write twice. V39 vc.reminder is unchanged.

\set ON_ERROR_STOP on

DO $$
DECLARE
    v_def text;
BEGIN
    SELECT indexdef INTO v_def
      FROM pg_indexes
     WHERE schemaname = 'vc' AND indexname = 'follow_up_one_live_job';
    IF v_def IS NULL OR v_def NOT LIKE '%PENDING%' OR v_def NOT LIKE '%CLAIMED%'
       OR v_def LIKE '%CANCELLED%' THEN
        RAISE EXCEPTION 'live follow-up index is %', v_def;
    END IF;
END $$;

INSERT INTO vc.vc_user(id, display_name) VALUES
    (19701, 'w09 hold owner'),
    (19702, 'w09 hold other');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (19701, 19710, 'persona-s5', true),
    (19702, 19720, 'persona-other', true);

INSERT INTO vc.conversation(
    owner_user_id, id, relationship_id, title, st_chat_identity, st_mode, st_source_state, incognito)
VALUES (
    19701, 19710, 19710, 'w09-s5',
    '19700000-0000-4000-8000-000000000197', 'COMPANION', 'PRESENT', false);
INSERT INTO vc.st_message_source(
    owner_user_id, conversation_id, message_id, candidate_id, source_revision, source_generation,
    source_ref, role, content_cipher, present, settled, eligible, suppressed, source_position)
VALUES (
    19701, 19710, '11111111-1111-4111-8111-000000000197', '22222222-2222-4222-8222-000000000197',
    1, 1, 'st:19700000-0000-4000-8000-000000000197:11111111-1111-4111-8111-000000000197:22222222-2222-4222-8222-000000000197:1:1',
    'user', 'w09-hold', true, true, true, false, 1);

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5mem', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5mem', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
INSERT INTO vc.memory_item(id, owner_user_id, relationship_id, scope, summary, status) VALUES
    (19711, 19701, 19710, 'RELATIONSHIP', 'w09 hold a', 'ACCEPTED'),
    (19712, 19701, 19710, 'RELATIONSHIP', 'w09 hold b', 'ACCEPTED');
INSERT INTO vc.memory_evidence(owner_user_id, id, memory_item_id, source_ref) VALUES
    (19701, 19721, 19711, 'st:19700000-0000-4000-8000-000000000197:11111111-1111-4111-8111-000000000197:22222222-2222-4222-8222-000000000197:1:1'),
    (19701, 19722, 19712, 'st:19700000-0000-4000-8000-000000000197:11111111-1111-4111-8111-000000000197:22222222-2222-4222-8222-000000000197:1:1');
COMMIT;
RESET ROLE;

CREATE TEMP TABLE w09_hold(follow_a bigint, follow_b bigint);
INSERT INTO w09_hold VALUES (NULL, NULL);
GRANT ALL ON TABLE w09_hold TO vc_api, vc_worker;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5ins', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5ins', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_ref text := 'st:19700000-0000-4000-8000-000000000197:11111111-1111-4111-8111-000000000197:22222222-2222-4222-8222-000000000197:1:1';
    v_a bigint;
    v_b bigint;
BEGIN
    v_a := vc.insert_follow_up(
        19701, 19710, 19711, v_ref, 1, 'w09 hold a',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-11-02', '15:04', 'Asia/Shanghai', timestamptz '2026-11-02 15:04:00+08');
    v_b := vc.insert_follow_up(
        19701, 19710, 19712, v_ref, 1, 'w09 hold b',
        'SCHEDULED', 'explicit_date', 'minute', false,
        DATE '2026-12-01', '09:00', 'Asia/Shanghai', timestamptz '2026-12-01 09:00:00+08');
    UPDATE w09_hold SET follow_a = v_a, follow_b = v_b;
END $$;
COMMIT;
RESET ROLE;

-- No policy: enqueue writes nothing and does not spend a wait.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5off', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5off', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_job bigint;
    v_created boolean;
    v_status text;
    v_waits integer;
    v_date date;
    v_time text;
    v_zone text;
    v_trigger timestamptz;
BEGIN
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_a FROM w09_hold), 'enqueue', NULL);
    SELECT status, generation_deferrals, event_date, event_time, event_timezone, trigger_at
      INTO v_status, v_waits, v_date, v_time, v_zone, v_trigger
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_a FROM w09_hold);
    IF v_job <> 0 OR v_created OR v_status <> 'SCHEDULED' OR v_waits <> 0
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS DISTINCT FROM timestamptz '2026-11-02 15:04:00+08' THEN
        RAISE EXCEPTION 'closed policy enqueued or spent a wait';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5pol', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5pol', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.put_proactive_policy(
    19701, 19710, true, NULL, NULL, NULL, 3, 0, ARRAY['COMPANION'], true);
COMMIT;
RESET ROLE;

-- Two calls share one live job. A second pending row is rejected.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5q', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5q', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_job bigint;
    v_again bigint;
    v_created boolean;
    v_again_created boolean;
    v_live integer;
BEGIN
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_a FROM w09_hold), 'enqueue', NULL);
    SELECT out_job, out_created INTO v_again, v_again_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_a FROM w09_hold), 'enqueue', NULL);
    SELECT count(*)::integer INTO v_live
      FROM vc.work_item
     WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
       AND ref_id = (SELECT follow_a FROM w09_hold)
       AND status IN ('PENDING', 'CLAIMED');
    IF NOT v_created OR v_again_created OR v_job IS NULL OR v_job <> v_again OR v_live <> 1 THEN
        RAISE EXCEPTION 'enqueue did not keep one live job (%, %, live %)', v_job, v_again, v_live;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (
        19701, nextval('vc.work_item_id_seq'), 'FOLLOW_UP',
        (SELECT follow_a FROM w09_hold), 'PENDING');
    RAISE EXCEPTION 'second live job was inserted';
EXCEPTION WHEN unique_violation THEN
    NULL;
END $$;

-- The first miss waits six hours and does not store a greeting. A repeat does
-- not move that wait. The eleven-argument call still resolves.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5hold', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5hold', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_status text;
    v_date date;
    v_time text;
    v_zone text;
    v_trigger timestamptz;
    v_until timestamptz;
    v_greeting text;
    v_outcome text;
    v_reason text;
    v_waits integer;
    v_body text;
    v_event text;
BEGIN
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_a FROM w09_hold), 'NOT_GENERATED', 'UNBOUND', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, timestamptz '2026-11-02 16:00:00+08');
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_a FROM w09_hold), 'NOT_GENERATED', 'UNBOUND', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL);
    SELECT status, event_date, event_time, event_timezone, trigger_at, deferred_until,
           greeting_body, generation_outcome, generation_reason, generation_deferrals,
           body, event_id
      INTO v_status, v_date, v_time, v_zone, v_trigger, v_until, v_greeting, v_outcome,
           v_reason, v_waits, v_body, v_event
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_a FROM w09_hold);
    IF v_status <> 'DEFERRED' OR v_waits <> 1
       OR v_until IS DISTINCT FROM timestamptz '2026-11-02 22:00:00+08'
       OR v_greeting IS NOT NULL OR v_outcome <> 'NOT_GENERATED' OR v_reason <> 'UNBOUND'
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS NOT NULL
       OR v_body <> 'w09 hold a' OR v_event <> 'fu-m-19711' THEN
        RAISE EXCEPTION 'first hold moved the event or stored a greeting';
    END IF;
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.work_item
   SET status = 'FAILED'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_a FROM w09_hold)
   AND status IN ('PENDING', 'CLAIMED');

-- Ended work is not queued. The row is due again at the stored wait.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5due', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5due', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_rows integer;
    v_queued boolean;
BEGIN
    SELECT count(*)::integer INTO v_rows
      FROM vc.list_due_follow_ups(timestamptz '2026-11-02 21:59:00+08')
     WHERE out_id = (SELECT follow_a FROM w09_hold);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'hold was due before its instant';
    END IF;
    SELECT count(*)::integer, bool_or(out_queued)
      INTO v_rows, v_queued
      FROM vc.list_due_follow_ups(timestamptz '2026-11-02 22:00:00+08')
     WHERE out_id = (SELECT follow_a FROM w09_hold);
    IF v_rows <> 1 OR v_queued THEN
        RAISE EXCEPTION 'ended job still looked live (rows %, queued %)', v_rows, v_queued;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Turning the policy off leaves the wait in place and does not spend it.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5dis', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5dis', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.put_proactive_policy(
    19701, 19710, false, NULL, NULL, NULL, 3, 0, ARRAY['COMPANION'], true);
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5stay', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5stay', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_job bigint;
    v_created boolean;
    v_status text;
    v_until timestamptz;
    v_waits integer;
    v_live integer;
BEGIN
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_a FROM w09_hold), 'enqueue', NULL);
    SELECT status, deferred_until, generation_deferrals
      INTO v_status, v_until, v_waits
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_a FROM w09_hold);
    SELECT count(*)::integer INTO v_live
      FROM vc.work_item
     WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
       AND ref_id = (SELECT follow_a FROM w09_hold)
       AND status IN ('PENDING', 'CLAIMED');
    IF v_job <> 0 OR v_created OR v_status <> 'DEFERRED' OR v_waits <> 1 OR v_live <> 0
       OR v_until IS DISTINCT FROM timestamptz '2026-11-02 22:00:00+08' THEN
        RAISE EXCEPTION 'closed policy spent the wait or queued work';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5on', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5on', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
SELECT vc.put_proactive_policy(
    19701, 19710, true, NULL, NULL, NULL, 3, 0, ARRAY['COMPANION'], true);
COMMIT;
RESET ROLE;

-- The same follow-up is queued again. A finished job does not block it.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5re', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5re', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_job bigint;
    v_created boolean;
    v_status text;
    v_date date;
    v_time text;
    v_zone text;
    v_trigger timestamptz;
    v_until timestamptz;
    v_waits integer;
    v_live integer;
BEGIN
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_a FROM w09_hold), 'enqueue', NULL);
    SELECT status, event_date, event_time, event_timezone, trigger_at, deferred_until,
           generation_deferrals
      INTO v_status, v_date, v_time, v_zone, v_trigger, v_until, v_waits
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_a FROM w09_hold);
    SELECT count(*)::integer INTO v_live
      FROM vc.work_item
     WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
       AND ref_id = (SELECT follow_a FROM w09_hold)
       AND status IN ('PENDING', 'CLAIMED');
    IF NOT v_created OR v_status <> 'SCHEDULED' OR v_waits <> 1 OR v_until IS NOT NULL
       OR v_live <> 1
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_trigger IS DISTINCT FROM timestamptz '2026-11-02 15:04:00+08' THEN
        RAISE EXCEPTION 'requeue did not restore the stored plan once';
    END IF;
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.work_item
   SET status = 'DONE'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_a FROM w09_hold)
   AND status IN ('PENDING', 'CLAIMED');

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5done', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5done', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_created boolean;
    v_live integer;
BEGIN
    SELECT out_created INTO v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_a FROM w09_hold), 'enqueue', NULL);
    SELECT count(*)::integer INTO v_live
      FROM vc.work_item
     WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
       AND ref_id = (SELECT follow_a FROM w09_hold)
       AND status IN ('PENDING', 'CLAIMED');
    IF NOT v_created OR v_live <> 1 THEN
        RAISE EXCEPTION 'a finished job blocked the next live job';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (
        19701, nextval('vc.work_item_id_seq'), 'FOLLOW_UP',
        (SELECT follow_a FROM w09_hold), 'PENDING');
    RAISE EXCEPTION 'second live job was inserted after requeue';
EXCEPTION WHEN unique_violation THEN
    NULL;
END $$;

-- The greeting is stored once. A second finish keeps the first sentence.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5body', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5body', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_status text;
    v_greeting text;
    v_event text;
    v_date date;
    v_time text;
    v_zone text;
    v_body text;
BEGIN
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_a FROM w09_hold), 'BODY_READY', 'BODY_READY', '下周见',
        'greet-prov', 'greet-model', 'OPENAI_CHAT_COMPLETIONS', 4, 9, NULL,
        timestamptz '2026-11-02 22:00:00+08');
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_a FROM w09_hold), 'BODY_READY', 'BODY_READY', '另一句',
        NULL, NULL, NULL, NULL, NULL, NULL);
    SELECT status, greeting_body, event_id, event_date, event_time, event_timezone, body
      INTO v_status, v_greeting, v_event, v_date, v_time, v_zone, v_body
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_a FROM w09_hold);
    IF v_status <> 'BODY_READY' OR v_greeting <> '下周见' OR v_event <> 'fu-m-19711'
       OR v_body <> 'w09 hold a'
       OR v_date IS DISTINCT FROM DATE '2026-11-02'
       OR v_time IS DISTINCT FROM '15:04'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai' THEN
        RAISE EXCEPTION 'repeated generation rewrote the greeting or the event';
    END IF;
END $$;
COMMIT;
RESET ROLE;

INSERT INTO vc.model_unit_price(provider_id, model_id, price_version, input_usd_per_1k, output_usd_per_1k)
VALUES ('greet-prov', 'greet-model', 1, 0.001, 0.002)
ON CONFLICT (provider_id, model_id, price_version) DO NOTHING;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cost', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cost', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_decision text;
    v_again text;
BEGIN
    v_decision := vc.prepare_follow_up_model_call(
        19701, 19790, 'follow-up:19711', 'greet-prov', 'greet-model', 10, 16, 1000000, 100000000000);
    v_again := vc.prepare_follow_up_model_call(
        19701, 19790, 'follow-up:19711', 'greet-prov', 'greet-model', 10, 16, 1000000, 100000000000);
    IF v_decision <> 'HELD' OR v_again <> 'REUSED_HELD' THEN
        RAISE EXCEPTION 'cost prepare decisions were % then %', v_decision, v_again;
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    v_count integer;
    v_reserved text;
BEGIN
    SELECT count(*)::integer, coalesce(sum(reserved_usd), 0)::text
      INTO v_count, v_reserved
      FROM vc.model_cost_reservation
     WHERE provider_attempt_id = 'follow-up:19711';
    IF v_count <> 1 OR v_reserved <> '1.000000' THEN
        RAISE EXCEPTION 'reservation was doubled: count % reserved %', v_count, v_reserved;
    END IF;
END $$;

-- Three waits, then the fourth miss is silent and is not queued again.
BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap1', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_created boolean;
BEGIN
    SELECT out_created INTO v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_b FROM w09_hold), 'enqueue', NULL);
    IF NOT v_created THEN
        RAISE EXCEPTION 'cap row was not queued';
    END IF;
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.work_item
   SET status = 'FAILED'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_b FROM w09_hold)
   AND status IN ('PENDING', 'CLAIMED');

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap2', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_status text;
    v_until timestamptz;
    v_waits integer;
    v_date date;
    v_time text;
    v_zone text;
    v_greeting text;
    v_reason text;
BEGIN
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_b FROM w09_hold), 'NOT_GENERATED', 'NO_PRICE', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, timestamptz '2026-11-02 16:00:00+08');
    SELECT status, deferred_until, generation_deferrals, event_date, event_time, event_timezone,
           greeting_body, generation_reason
      INTO v_status, v_until, v_waits, v_date, v_time, v_zone, v_greeting, v_reason
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_b FROM w09_hold);
    IF v_status <> 'DEFERRED' OR v_waits <> 1
       OR v_until IS DISTINCT FROM timestamptz '2026-11-02 22:00:00+08'
       OR v_greeting IS NOT NULL OR v_reason <> 'NO_PRICE'
       OR v_date IS DISTINCT FROM DATE '2026-12-01'
       OR v_time IS DISTINCT FROM '09:00'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai' THEN
        RAISE EXCEPTION 'first cap wait was wrong';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The job from the initial enqueue was already failed. Requeue, fail, and
-- repeat until the fourth miss.
UPDATE vc.work_item SET status = 'FAILED'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_b FROM w09_hold) AND status IN ('PENDING', 'CLAIMED');

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap3', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
SELECT vc.apply_follow_up_due(19701, (SELECT follow_b FROM w09_hold), 'enqueue', NULL);
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap4', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_until timestamptz;
    v_waits integer;
    v_status text;
BEGIN
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_b FROM w09_hold), 'NOT_GENERATED', 'NO_PRICE', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, timestamptz '2026-11-02 22:00:00+08');
    SELECT status, deferred_until, generation_deferrals
      INTO v_status, v_until, v_waits
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_b FROM w09_hold);
    IF v_status <> 'DEFERRED' OR v_waits <> 2
       OR v_until IS DISTINCT FROM timestamptz '2026-11-03 10:00:00+08' THEN
        RAISE EXCEPTION 'second cap wait was wrong';
    END IF;
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.work_item SET status = 'FAILED'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_b FROM w09_hold) AND status IN ('PENDING', 'CLAIMED');

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap5', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
SELECT vc.apply_follow_up_due(19701, (SELECT follow_b FROM w09_hold), 'enqueue', NULL);
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap6', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_until timestamptz;
    v_waits integer;
    v_status text;
BEGIN
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_b FROM w09_hold), 'NOT_GENERATED', 'NO_PRICE', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, timestamptz '2026-11-03 10:00:00+08');
    SELECT status, deferred_until, generation_deferrals
      INTO v_status, v_until, v_waits
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_b FROM w09_hold);
    IF v_status <> 'DEFERRED' OR v_waits <> 3
       OR v_until IS DISTINCT FROM timestamptz '2026-11-04 10:00:00+08' THEN
        RAISE EXCEPTION 'third cap wait was wrong';
    END IF;
END $$;
COMMIT;
RESET ROLE;

UPDATE vc.work_item SET status = 'FAILED'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_b FROM w09_hold) AND status IN ('PENDING', 'CLAIMED');

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap7', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap7', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
SELECT vc.apply_follow_up_due(19701, (SELECT follow_b FROM w09_hold), 'enqueue', NULL);
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap8', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap8', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_status text;
    v_until timestamptz;
    v_trigger timestamptz;
    v_waits integer;
    v_greeting text;
    v_reason text;
    v_outcome text;
    v_date date;
    v_time text;
    v_zone text;
    v_event text;
    v_job bigint;
    v_created boolean;
    v_live integer;
BEGIN
    PERFORM vc.finish_follow_up_generation(
        19701, (SELECT follow_b FROM w09_hold), 'NOT_GENERATED', 'NO_PRICE', NULL,
        NULL, NULL, NULL, NULL, NULL, NULL, timestamptz '2026-11-04 10:00:00+08');
    SELECT status, deferred_until, trigger_at, generation_deferrals, greeting_body,
           generation_reason, generation_outcome, event_date, event_time, event_timezone, event_id
      INTO v_status, v_until, v_trigger, v_waits, v_greeting, v_reason, v_outcome,
           v_date, v_time, v_zone, v_event
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_b FROM w09_hold);
    IF v_status <> 'SILENT' OR v_waits <> 3 OR v_until IS NOT NULL OR v_trigger IS NOT NULL
       OR v_greeting IS NOT NULL OR v_reason <> 'NO_PRICE' OR v_outcome <> 'NOT_GENERATED'
       OR v_date IS DISTINCT FROM DATE '2026-12-01'
       OR v_time IS DISTINCT FROM '09:00'
       OR v_zone IS DISTINCT FROM 'Asia/Shanghai'
       OR v_event <> 'fu-m-19712' THEN
        RAISE EXCEPTION 'cap did not stay silent with its reason';
    END IF;
    SELECT out_job, out_created INTO v_job, v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_b FROM w09_hold), 'enqueue', NULL);
    SELECT count(*)::integer INTO v_live
      FROM vc.work_item
     WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
       AND ref_id = (SELECT follow_b FROM w09_hold)
       AND status IN ('PENDING', 'CLAIMED');
    IF v_job <> 0 OR v_created OR v_live <> 1 THEN
        RAISE EXCEPTION 'silent follow-up was queued again (live %)', v_live;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- The job claimed before the silent finish is still live until the worker
-- closes it. Closing it must not create another one.
UPDATE vc.work_item SET status = 'FAILED'
 WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
   AND ref_id = (SELECT follow_b FROM w09_hold) AND status IN ('PENDING', 'CLAIMED');

BEGIN;
SELECT vc.set_owner_context(19701, 'w09s5cap9', encode(vc.hmac(convert_to('vc-owner-binding-v1|19701|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5cap9', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE
    v_created boolean;
    v_live integer;
    v_status text;
BEGIN
    SELECT out_created INTO v_created
      FROM vc.apply_follow_up_due(19701, (SELECT follow_b FROM w09_hold), 'enqueue', NULL);
    SELECT status INTO v_status
      FROM vc.follow_up
     WHERE owner_user_id = 19701 AND id = (SELECT follow_b FROM w09_hold);
    SELECT count(*)::integer INTO v_live
      FROM vc.work_item
     WHERE owner_user_id = 19701 AND kind = 'FOLLOW_UP'
       AND ref_id = (SELECT follow_b FROM w09_hold)
       AND status IN ('PENDING', 'CLAIMED');
    IF v_created OR v_status <> 'SILENT' OR v_live <> 0 THEN
        RAISE EXCEPTION 'silent follow-up queued after its job ended';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(19702, 'w09s5other', encode(vc.hmac(convert_to('vc-owner-binding-v1|19702|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|w09s5other', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF (SELECT count(*) FROM vc.follow_up WHERE owner_user_id = 19701) <> 0 THEN
        RAISE EXCEPTION 'other owner saw a held follow-up';
    END IF;
    BEGIN
        PERFORM vc.finish_follow_up_generation(
            19701, (SELECT follow_a FROM w09_hold), 'NOT_GENERATED', 'UNBOUND', NULL,
            NULL, NULL, NULL, NULL, NULL, NULL);
        RAISE EXCEPTION 'cross-owner finish unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'p_owner_user_id does not match server-trusted current_owner_id' THEN
            RAISE;
        END IF;
    END;
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
