-- 107_usage_health: USAGE-HEALTH V52 — prefs, heartbeat, reminder due.
--
-- Covers: defaults 120/30; update writes approved prefs; heartbeat starts a
-- session; activity inside the gap extends it; a gap restart zeros continuous
-- minutes; reminderDue after reminder_after minutes; CONTINUED defers the next
-- reminder; unapproved prefs RAISE; trusted-owner mismatch fail-closed;
-- vc_worker cannot execute.

\set ON_ERROR_STOP on

TRUNCATE vc.usage_reminder_event, vc.usage_session, vc.usage_health_prefs,
         vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_after int;
    v_gap int;
    v_cont int;
    v_due boolean;
    t0 timestamptz := timestamptz '2026-08-18 00:00:00+00';
BEGIN
    SELECT out_reminder_after_minutes, out_session_gap_minutes,
           out_continuous_minutes, out_reminder_due
      INTO v_after, v_gap, v_cont, v_due
      FROM vc.get_usage_health(1, t0);
    IF v_after IS DISTINCT FROM 120 OR v_gap IS DISTINCT FROM 30
       OR v_cont IS DISTINCT FROM 0 OR v_due IS NOT FALSE THEN
        RAISE EXCEPTION 'defaults mismatch after=% gap=% cont=% due=%',
            v_after, v_gap, v_cont, v_due;
    END IF;

    IF vc.update_usage_health_prefs(1, 60, 15) IS NOT TRUE THEN
        RAISE EXCEPTION 'owned prefs update must succeed';
    END IF;

    SELECT out_reminder_after_minutes, out_session_gap_minutes
      INTO v_after, v_gap
      FROM vc.get_usage_health(1, t0);
    IF v_after IS DISTINCT FROM 60 OR v_gap IS DISTINCT FROM 15 THEN
        RAISE EXCEPTION 'prefs not written after=% gap=%', v_after, v_gap;
    END IF;

    PERFORM vc.usage_heartbeat(1, t0);
    SELECT out_continuous_minutes, out_reminder_due
      INTO v_cont, v_due
      FROM vc.usage_heartbeat(1, t0 + interval '10 minutes');
    IF v_cont IS DISTINCT FROM 10 OR v_due IS NOT FALSE THEN
        RAISE EXCEPTION '10-minute heartbeat mismatch cont=% due=%', v_cont, v_due;
    END IF;

    -- 15-minute gap + 1s restarts the session (last activity was t0+10m).
    SELECT out_continuous_minutes INTO v_cont
      FROM vc.usage_heartbeat(1, t0 + interval '26 minutes');
    IF v_cont IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'gap must restart the session, cont=%', v_cont;
    END IF;

    -- Keep the new session alive with activity inside the 15-minute gap
    -- until continuous minutes reach the 60-minute reminder.
    PERFORM vc.usage_heartbeat(1, t0 + interval '40 minutes');
    PERFORM vc.usage_heartbeat(1, t0 + interval '54 minutes');
    PERFORM vc.usage_heartbeat(1, t0 + interval '68 minutes');
    PERFORM vc.usage_heartbeat(1, t0 + interval '82 minutes');
    SELECT out_continuous_minutes, out_reminder_due
      INTO v_cont, v_due
      FROM vc.usage_heartbeat(1, t0 + interval '86 minutes');
    IF v_cont IS DISTINCT FROM 60 OR v_due IS NOT TRUE THEN
        RAISE EXCEPTION 'reminder must be due at 60 minutes, cont=% due=%', v_cont, v_due;
    END IF;

    PERFORM vc.record_usage_reminder(1, 'SHOWN', t0 + interval '86 minutes');
    SELECT out_reminder_due INTO v_due
      FROM vc.get_usage_health(1, t0 + interval '86 minutes');
    IF v_due IS NOT TRUE THEN
        RAISE EXCEPTION 'SHOWN must not defer the reminder';
    END IF;

    PERFORM vc.record_usage_reminder(1, 'CONTINUED', t0 + interval '86 minutes');
    SELECT out_reminder_due INTO v_due
      FROM vc.get_usage_health(1, t0 + interval '86 minutes');
    IF v_due IS NOT FALSE THEN
        RAISE EXCEPTION 'CONTINUED must defer the next reminder';
    END IF;

    BEGIN
        PERFORM vc.update_usage_health_prefs(1, 99, 15);
        RAISE EXCEPTION 'unapproved reminder interval unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved reminder interval unexpectedly succeeded%' THEN
            RAISE;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM vc.update_usage_health_prefs(1, 60, 15);
        RAISE EXCEPTION 'update must reject an owner mismatch';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%update must reject an owner mismatch%' THEN
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
    PERFORM vc.get_usage_health(1, now());
    RAISE EXCEPTION 'vc_worker unexpectedly executed get_usage_health';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL;
END $$;
COMMIT;
RESET ROLE;
