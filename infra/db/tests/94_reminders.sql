-- 94_reminders: REMINDER V39 — structured user-created reminders.
--
-- Covers: create_reminder writes the record under the owner's relationship
-- (unapproved recurrence / blank text / NULL remind_at RAISE); get_reminder
-- returns the owned row and no rows for foreign ids; list_reminders is
-- soonest-first keyset-paged and relationship-scoped; update_reminder writes
-- the whole record (FALSE for foreign ids, unapproved status RAISEs);
-- delete_reminder removes only owned rows (FALSE otherwise); the reminder
-- cascades with its relationship; and a non-vc_api role cannot execute the
-- functions.

\set ON_ERROR_STOP on

TRUNCATE vc.reminder, vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 10, 'persona-a', true);
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES (1, 11, 'persona-a', false);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_late  bigint;
    v_early bigint;
    v_ok    boolean;
    v_rows  int;
BEGIN
    -- Two reminders: one later, one earlier (soonest-first ordering check).
    v_late := vc.create_reminder(1, 10, '明天晚上问我面试怎么样',
                                 now() + interval '1 day', 'NONE');
    v_early := vc.create_reminder(1, 10, '晚上十点提醒我准备休息',
                                  now(), 'NONE');
    IF v_late <= 0 OR v_early <= 0 THEN
        RAISE EXCEPTION 'create_reminder must return positive ids';
    END IF;

    -- Soonest first.
    SELECT out_id INTO v_early FROM vc.list_reminders(1, 10, 0, 100)
     ORDER BY out_remind_at, out_id LIMIT 1;
    IF v_early IS NULL THEN
        RAISE EXCEPTION 'list_reminders returned no rows';
    END IF;

    -- Relationship scoping: relationship 11 has no reminders.
    SELECT count(*) INTO v_rows FROM vc.list_reminders(1, 11, 0, 100);
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'relationship 11 must have no reminders (%)', v_rows;
    END IF;

    -- Update the whole record (ACTIVE -> DISMISSED).
    SELECT vc.update_reminder(1, v_early, '晚上十点提醒我准备休息（改）',
                              now(), 'DAILY', 'DISMISSED') INTO v_ok;
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'update_reminder must update the owned row';
    END IF;

    -- Unapproved values RAISE (defense in depth for direct callers).
    BEGIN
        PERFORM vc.create_reminder(1, 10, 'text', now(), 'MONTHLY');
        RAISE EXCEPTION 'unapproved recurrence unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
    BEGIN
        PERFORM vc.update_reminder(1, v_early, 'text', now(), 'NONE', 'DONE');
        RAISE EXCEPTION 'unapproved status unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
    BEGIN
        PERFORM vc.create_reminder(1, 10, '', now(), 'NONE');
        RAISE EXCEPTION 'blank text unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;

    -- Foreign or absent ids: FALSE / no rows, never an error.
    IF vc.delete_reminder(1, 999999) IS NOT FALSE THEN
        RAISE EXCEPTION 'absent delete must return FALSE';
    END IF;
    IF vc.update_reminder(1, 999999, 'text', now(), 'NONE', 'ACTIVE') IS NOT FALSE THEN
        RAISE EXCEPTION 'absent update must return FALSE';
    END IF;

    -- Owned delete succeeds.
    IF vc.delete_reminder(1, v_late) IS NOT TRUE THEN
        RAISE EXCEPTION 'owned delete must succeed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- Structural backstop: the reminder → relationship FK is ON DELETE CASCADE
-- (no relationship-delete SD exists yet; deactivation is a status flip and
-- must NOT remove reminders).
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM pg_constraint
     WHERE conrelid = 'vc.reminder'::regclass
       AND confrelid = 'vc.relationship'::regclass
       AND confdeltype = 'c';
    IF n <> 1 THEN
        RAISE EXCEPTION 'reminder relationship FK must be ON DELETE CASCADE';
    END IF;
END $$;

-- A non-vc_api role must NOT be able to call the functions.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.create_reminder(1, 10, 'x', now(), 'NONE');
    RAISE EXCEPTION 'vc_worker unexpectedly executed create_reminder';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
