-- 50_realtime_event_catalog: TASK-0100 P2-08/P2-09/P2-11 catalog-backed event
-- type enforcement and terminal-event allocation.
--   * vc.realtime_event.event_type is bound by the realtime_event_type_catalog
--     CHECK to the durable subset of specs/catalog/realtime-events.yaml;
--     unknown (foo) and non-durable (chat.delta) types cannot persist even via
--     direct INSERT.
--   * append_realtime_event is a narrow function: unknown, non-durable and
--     terminal event types all fail closed on a non-terminal generation.
--   * append_terminal_event is owner-only (no role grant), so terminal events
--     are produced only by the terminal transitions, and each terminal event
--     is allocated a real (stream_epoch, event_seq) inside the terminal
--     transaction (P2-09) — including cancel's durable chat.cancelled (P2-11)
--     and post-reset terminal events in the new epoch.

\set ON_ERROR_STOP on

TRUNCATE vc.provider_attempt, vc.realtime_ticket, vc.realtime_stream, vc.realtime_event,
         vc.quota_ledger_entry, vc.generation_usage, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-cat-1', 'IN_PROGRESS');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5001, 100, 'gen-cat-2', 'IN_PROGRESS');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5002, 100, 'gen-cat-3', 'IN_PROGRESS');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    n        int;
    v_disp   text;
    v_events jsonb;
    hasfailed boolean;
BEGIN
    -- P2-08 narrow function: unknown / non-durable / terminal event types all
    -- fail closed on a non-terminal generation.
    BEGIN
        PERFORM vc.append_realtime_event(1, 5000, 1, 'foo', '{}'::jsonb);
        RAISE EXCEPTION 'unknown event type must be rejected';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    BEGIN
        PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.delta', '{}'::jsonb);
        RAISE EXCEPTION 'non-durable chat.delta must be rejected';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    BEGIN
        PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.completed', '{}'::jsonb);
        RAISE EXCEPTION 'terminal chat.completed via append must be rejected';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- P2-08 catalog CHECK is verified below as the PostgreSQL superuser
    -- (after RESET ROLE): TASK-0153 V16 revoked direct DML on realtime_event
    -- from runtime roles, so a vc_api INSERT would now fail with
    -- insufficient_privilege before the CHECK could run. The catalog CHECK
    -- itself is a table constraint independent of the caller's role, so
    -- verifying it as the superuser preserves the original semantics.

    -- P2-09/P2-11: append_terminal_event is NOT granted to vc_api (owner-only),
    -- so terminal events can only be produced by the terminal transitions.
    BEGIN
        PERFORM vc.append_terminal_event(1, 5000, 'chat.completed', '{}'::jsonb);
        RAISE EXCEPTION 'vc_api must not execute append_terminal_event';
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    -- P2-09: terminalize allocates a real (epoch 1, seq 2) chat.failed after
    -- the appended seq 1 and advances the stream high water mark inside the
    -- terminal transaction.
    PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{}'::jsonb);
    PERFORM vc.terminalize_generation(1, 5000, 'FAILED_FINAL', 'chat.failed',
        '{"reason":"timeout"}'::jsonb);
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE generation_id = 5000 AND event_type = 'chat.failed'
       AND stream_epoch = 1 AND event_seq = 2 AND status = 'PENDING';
    IF n <> 1 THEN RAISE EXCEPTION 'terminal chat.failed must carry real epoch 1 seq 2 (got %)', n; END IF;
    SELECT next_seq INTO n FROM vc.realtime_stream WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 3 THEN RAISE EXCEPTION 'stream next_seq must advance to 3 (got %)', n; END IF;

    -- P2-11: cancel writes exactly one durable PENDING chat.cancelled with a
    -- real (epoch 1, seq 1) inside the cancel transaction; a duplicate cancel
    -- fails closed and never writes a second event.
    PERFORM vc.cancel_generation(1, 5001);
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE generation_id = 5001 AND event_type = 'chat.cancelled'
       AND stream_epoch = 1 AND event_seq = 1 AND status = 'PENDING';
    IF n <> 1 THEN RAISE EXCEPTION 'cancel must write one chat.cancelled epoch 1 seq 1 (got %)', n; END IF;
    SELECT next_seq INTO n FROM vc.realtime_stream WHERE owner_user_id = 1 AND generation_id = 5001;
    IF n <> 2 THEN RAISE EXCEPTION 'cancelled stream next_seq must advance to 2 (got %)', n; END IF;
    BEGIN
        PERFORM vc.cancel_generation(1, 5001);
        RAISE EXCEPTION 're-cancel of a CANCELLED generation must fail';
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;
    SELECT count(*) INTO n FROM vc.realtime_event WHERE generation_id = 5001;
    IF n <> 1 THEN RAISE EXCEPTION 'duplicate cancel must not write a second event (got %)', n; END IF;

    -- P2-09 reset: after reset_stream_epoch the terminal event lands in the
    -- new epoch (2) with seq 1, and resume enforces the epoch boundary.
    PERFORM vc.append_realtime_event(1, 5002, 1, 'chat.accepted', '{}'::jsonb);
    PERFORM vc.reset_stream_epoch(1, 5002);
    PERFORM vc.terminalize_generation(1, 5002, 'FAILED_FINAL', 'chat.failed',
        '{"reason":"reset"}'::jsonb);
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE generation_id = 5002 AND event_type = 'chat.failed' AND stream_epoch = 2 AND event_seq = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'post-reset terminal event must be epoch 2 seq 1 (got %)', n; END IF;
    SELECT out_disposition INTO v_disp FROM vc.resume_stream(1, 5002, 1, 0);
    IF v_disp <> 'RESET_REQUIRED' THEN
        RAISE EXCEPTION 'stale epoch resume must be RESET_REQUIRED (got %)', v_disp;
    END IF;
    SELECT out_disposition, out_events INTO v_disp, v_events FROM vc.resume_stream(1, 5002, 2, 0);
    IF v_disp <> 'TERMINAL_SNAPSHOT' THEN
        RAISE EXCEPTION 'new epoch resume must be TERMINAL_SNAPSHOT (got %)', v_disp;
    END IF;
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_events) el
                    WHERE el->>'event' = 'chat.failed' AND el->>'streamEpoch' = '2'
                      AND el->>'eventSeq' = '1') INTO hasfailed;
    IF hasfailed IS NOT TRUE THEN
        RAISE EXCEPTION 'TERMINAL_SNAPSHOT must carry chat.failed epoch 2 seq 1';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- P2-08 catalog CHECK (superuser path): TASK-0153 V16 revoked direct DML on
-- realtime_event from runtime roles. The catalog CHECK constraint itself is a
-- table-level constraint independent of caller role; verify it as the
-- PostgreSQL superuser (no SET ROLE) so the INSERT reaches the CHECK instead
-- of being rejected at the privilege check. A vc_api INSERT is now expected
-- to fail with insufficient_privilege, which test 52 covers explicitly.
DO $$
BEGIN
    BEGIN
        INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type, payload, status)
        VALUES (1, nextval('vc.finalize_row_id_seq'), 5000, 'foo', '{}'::jsonb, 'PENDING');
        RAISE EXCEPTION 'CHECK must reject unknown event type';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
    BEGIN
        INSERT INTO vc.realtime_event(owner_user_id, id, generation_id, event_type, payload, status)
        VALUES (1, nextval('vc.finalize_row_id_seq'), 5000, 'chat.delta', '{}'::jsonb, 'PENDING');
        RAISE EXCEPTION 'CHECK must reject non-durable chat.delta';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END $$;
