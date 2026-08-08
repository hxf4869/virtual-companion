-- 42_terminal_event_atomic: terminalize_generation writes the terminal
-- realtime_event atomically with the status change (INV-TX-001) and only the
-- matching event type (INV-GEN-003: no fabricated chat.completed on a failed
-- generation). TASK-0100 P2-09: the terminal event is allocated from the
-- shared stream allocator (real epoch 1 / seq 1, high water mark advanced);
-- P2-08: append_realtime_event rejects non-durable types (chat.delta). A
-- terminal generation continues to reject append_realtime_event, and
-- resume_stream returns TERMINAL_SNAPSHOT with the committed terminal event.

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
VALUES (1, 5000, 100, 'gen-ae-1', 'IN_PROGRESS');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5001, 100, 'gen-ae-2', 'IN_PROGRESS');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    n        int;
    v_type   text;
    v_status text;
    v_disp   text;
    v_events jsonb;
    hasfailed boolean;
BEGIN
    -- Terminalize writes FAILED_FINAL + chat.failed in the same transaction.
    PERFORM vc.terminalize_generation(1, 5000, 'FAILED_FINAL', 'chat.failed',
        '{"reason":"timeout"}'::jsonb);
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE generation_id = 5000 AND event_type = 'chat.failed' AND status = 'PENDING';
    IF n <> 1 THEN
        RAISE EXCEPTION 'terminalize must write exactly one PENDING chat.failed (got %)', n;
    END IF;
    -- TASK-0100 P2-09: the terminal event carries the real allocated epoch/seq
    -- (1/1) and the stream high water mark advanced to 2 inside the terminal txn.
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE generation_id = 5000 AND event_type = 'chat.failed'
       AND stream_epoch = 1 AND event_seq = 1;
    IF n <> 1 THEN
        RAISE EXCEPTION 'terminal event must carry real epoch 1 seq 1 (got %)', n;
    END IF;
    SELECT next_seq INTO n FROM vc.realtime_stream
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 2 THEN
        RAISE EXCEPTION 'stream next_seq must advance to 2 (got %)', n;
    END IF;
    SELECT status INTO v_status FROM vc.generation WHERE owner_user_id = 1 AND id = 5000;
    IF v_status <> 'FAILED_FINAL' THEN
        RAISE EXCEPTION 'status must be FAILED_FINAL (got %)', v_status;
    END IF;

    -- A failed generation must not carry chat.completed (INV-GEN-003).
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE generation_id = 5000 AND event_type = 'chat.completed';
    IF n <> 0 THEN
        RAISE EXCEPTION 'failed generation must not fabricate chat.completed (got %)', n;
    END IF;

    -- Terminal generations reject new durable events (append defense), and
    -- P2-08 narrow validation rejects the non-durable chat.delta type.
    BEGIN
        PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.delta', '{}'::jsonb);
        RAISE EXCEPTION 'append to a terminal generation must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- Event type must match the terminal state (INV-GEN-003).
    BEGIN
        PERFORM vc.terminalize_generation(1, 5001, 'FAILED_FINAL', 'chat.completed');
        RAISE EXCEPTION 'chat.completed on FAILED_FINAL must be rejected';
    EXCEPTION WHEN OTHERS THEN
        -- expected
    END;

    -- resume_stream returns TERMINAL_SNAPSHOT including the committed
    -- chat.failed terminal event.
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 1, 0);
    IF v_disp <> 'TERMINAL_SNAPSHOT' THEN
        RAISE EXCEPTION 'terminal generation must resume TERMINAL_SNAPSHOT (got %)', v_disp;
    END IF;
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_events) el
                    WHERE el->>'event' = 'chat.failed') INTO hasfailed;
    IF hasfailed IS NOT TRUE THEN
        RAISE EXCEPTION 'TERMINAL_SNAPSHOT events must include chat.failed';
    END IF;
END $$;
COMMIT;
RESET ROLE;
