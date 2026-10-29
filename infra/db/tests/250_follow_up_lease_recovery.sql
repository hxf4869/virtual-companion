-- W16-1: an expired FOLLOW_UP claim is requeued for its owner only.
-- A live lease is left alone. The third expiry dead-letters and, when no
-- greeting was stored, the follow-up becomes SILENT so it cannot be queued
-- again. Another owner cannot recover the row.

\set ON_ERROR_STOP on

TRUNCATE vc.follow_up, vc.work_item, vc.memory_item, vc.conversation, vc.relationship, vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 10, 'persona-a', true), (2, 20, 'persona-b', true);
INSERT INTO vc.memory_item(owner_user_id, id, relationship_id, scope, summary, status)
VALUES (1, 25001, 10, 'RELATIONSHIP', '复查', 'ACCEPTED');
INSERT INTO vc.follow_up(
    owner_user_id, id, relationship_id, memory_item_id, body, status, normalization_status,
    time_precision, event_date, event_time, event_timezone, trigger_at, event_id, source_ref)
VALUES (
    1, 25011, 10, 25001, '复查', 'SCHEDULED', 'explicit_date',
    'minute', DATE '2026-11-02', '15:04', 'Asia/Shanghai',
    clock_timestamp() - interval '1 hour', 'fu-250', 'st:11111111-1111-4111-8111-111111111111');
INSERT INTO vc.work_item(
    owner_user_id, id, kind, ref_id, status, claim_token, claim_fence,
    claimed_at, lease_expires_at, attempt_count)
VALUES (
    1, 25021, 'FOLLOW_UP', 25011, 'CLAIMED', 'tok', 'fence',
    clock_timestamp(), clock_timestamp() + interval '5 minutes', 0);

BEGIN;
SELECT vc.set_owner_context(1, 'm250', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m250',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE v_action text;
BEGIN
    SELECT vc.go_recover_expired_follow_up(1, 25021, 3) INTO v_action;
    IF v_action IS DISTINCT FROM 'LEASE_ACTIVE' THEN
        RAISE EXCEPTION 'live lease action %', v_action;
    END IF;
END $$;
ROLLBACK;

UPDATE vc.work_item
   SET lease_expires_at = clock_timestamp() - interval '1 minute'
 WHERE owner_user_id = 1 AND id = 25021;

BEGIN;
SELECT vc.set_owner_context(2, 'm250b', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m250b',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.go_recover_expired_follow_up(1, 25021, 3);
    RAISE EXCEPTION 'cross owner recovered a follow-up';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%does not match server-trusted current_owner_id%' THEN
            RAISE;
        END IF;
END $$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(1, 'm250c', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m250c',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE v_action text; v_status text; v_attempts integer; v_token text; v_listed integer;
BEGIN
    SELECT count(*) INTO v_listed
      FROM vc.go_list_expired_follow_up_jobs(8)
     WHERE out_owner_user_id = 1 AND out_job_id = 25021;
    IF v_listed IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'expired follow-up not listed';
    END IF;
    SELECT vc.go_recover_expired_follow_up(1, 25021, 3) INTO v_action;
    IF v_action IS DISTINCT FROM 'REQUEUED' THEN
        RAISE EXCEPTION 'requeue action %', v_action;
    END IF;
    SELECT status, attempt_count, claim_token
      INTO v_status, v_attempts, v_token
      FROM vc.work_item WHERE owner_user_id = 1 AND id = 25021;
    IF v_status IS DISTINCT FROM 'PENDING' OR v_attempts IS DISTINCT FROM 1 OR v_token IS NOT NULL THEN
        RAISE EXCEPTION 'requeued row % % %', v_status, v_attempts, v_token;
    END IF;
END $$;
COMMIT;

UPDATE vc.work_item
   SET status = 'CLAIMED',
       attempt_count = 2,
       claim_token = 'tok2',
       claim_fence = 'fence2',
       lease_expires_at = clock_timestamp() - interval '1 minute'
 WHERE owner_user_id = 1 AND id = 25021;

BEGIN;
SELECT vc.set_owner_context(1, 'm250d', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|m250d',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
DECLARE v_action text; v_status text; v_code text; v_follow text; v_reason text; v_trigger timestamptz;
BEGIN
    SELECT vc.go_recover_expired_follow_up(1, 25021, 3) INTO v_action;
    IF v_action IS DISTINCT FROM 'DEAD_LETTERED' THEN
        RAISE EXCEPTION 'exhausted action %', v_action;
    END IF;
    SELECT status, last_error_code INTO v_status, v_code
      FROM vc.work_item WHERE owner_user_id = 1 AND id = 25021;
    IF v_status IS DISTINCT FROM 'DEAD_LETTERED' OR v_code IS DISTINCT FROM 'FOLLOW_UP_LEASE_EXHAUSTED' THEN
        RAISE EXCEPTION 'dead letter % %', v_status, v_code;
    END IF;
    SELECT status, generation_reason, trigger_at INTO v_follow, v_reason, v_trigger
      FROM vc.follow_up WHERE owner_user_id = 1 AND id = 25011;
    IF v_follow IS DISTINCT FROM 'SILENT' OR v_reason IS DISTINCT FROM 'LEASE_EXHAUSTED' OR v_trigger IS NOT NULL THEN
        RAISE EXCEPTION 'follow-up % % %', v_follow, v_reason, v_trigger;
    END IF;
END $$;
COMMIT;
