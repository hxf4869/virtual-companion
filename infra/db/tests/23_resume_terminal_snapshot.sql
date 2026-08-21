-- 23_resume_terminal_snapshot: a terminal generation (reached only via finalize,
-- INV-GEN-003) resumes as TERMINAL_SNAPSHOT with the committed status, assistant
-- message id and the durable terminal events. The client reconstructs the
-- committed state; chat.completed is PENDING in the DB and only ever published
-- after its transaction commits (INV-TX-001).
--
-- TASK-0100 P2-09: finalize's chat.completed is allocated from the shared
-- stream allocator, so it carries the real event_seq (2, after the appended
-- chat.accepted seq 1) and the stream high water mark advances to 3 — the
-- snapshot orders events by committed_at/event_seq consistently. The append
-- and finalize run in SEPARATE transactions (as they do in the real runtime)
-- so their committed_at differ.

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-snap-1', 'FINAL_REVIEW');
INSERT INTO vc.generation_candidate(owner_user_id, id, generation_id, content, is_final)
VALUES (1, 6000, 5000, 'draft answer', false);

-- Separate transaction 1: append a durable event (earlier committed_at).
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{"v":1}'::jsonb);
END $$;
COMMIT;
RESET ROLE;

-- Separate transaction 2: finalize, then resume and assert snapshot truth.
-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    r        record;
    v_disp   text;
    v_events jsonb;
    v_snap   jsonb;
    v_snapstatus text;
    n        int;
    hascompleted boolean;
BEGIN
    -- finalize_generation commits COMPLETED + assistant message + a PENDING
    -- chat.completed durable realtime event atomically (INV-TX-001).
    SELECT * INTO r FROM vc.finalize_generation(
        1, 5000, 6000, 'final answer', 'provider-a', 10, 5, 0.0010, 'USD', 1, true, NULL);
    IF r.out_finalized IS NOT TRUE THEN
        RAISE EXCEPTION 'finalize must report finalized=true';
    END IF;

    -- A terminal generation resumes as TERMINAL_SNAPSHOT regardless of cursor.
    SELECT out_disposition, out_events, out_snapshot INTO v_disp, v_events, v_snap
      FROM vc.resume_stream(1, 5000, 1, 0);
    IF v_disp <> 'TERMINAL_SNAPSHOT' THEN
        RAISE EXCEPTION 'terminal generation must be TERMINAL_SNAPSHOT (got %)', v_disp;
    END IF;
    IF v_snap->>'status' <> 'COMPLETED' THEN
        RAISE EXCEPTION 'snapshot status must be COMPLETED (got %)', v_snap->>'status';
    END IF;
    IF (v_snap->>'assistantMessageId')::bigint IS NULL
       OR (v_snap->>'assistantMessageId')::bigint <> r.out_assistant_message_id THEN
        RAISE EXCEPTION 'snapshot must carry the committed assistant message id';
    END IF;

    -- The snapshot events include the committed chat.completed.
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_events) el
                    WHERE el->>'event' = 'chat.completed') INTO hascompleted;
    IF hascompleted IS NOT TRUE THEN
        RAISE EXCEPTION 'TERMINAL_SNAPSHOT events must include chat.completed';
    END IF;

    -- R1 P1-2 regression (TASK-0100 P2-09 semantics): the appended
    -- chat.accepted (seq 1) must sort BEFORE finalize's chat.completed, which
    -- now carries the real allocated seq 2 from the stream allocator.
    IF jsonb_array_length(v_events) < 2 THEN
        RAISE EXCEPTION 'snapshot must contain the appended event and chat.completed';
    END IF;
    IF (v_events->0->>'event') <> 'chat.accepted' THEN
        RAISE EXCEPTION 'snapshot must order appended event first (got %)', v_events->0->>'event';
    END IF;
    n := jsonb_array_length(v_events) - 1;
    IF (v_events->n->>'event') <> 'chat.completed' THEN
        RAISE EXCEPTION 'snapshot must order chat.completed last by committed_at';
    END IF;

    -- TASK-0100 P2-09: chat.completed carries real epoch 1 / seq 2 and the
    -- stream high water mark advanced atomically to 3 in the finalize txn.
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000 AND event_type = 'chat.completed'
       AND stream_epoch = 1 AND event_seq = 2;
    IF n <> 1 THEN RAISE EXCEPTION 'chat.completed must carry real epoch 1 seq 2 (got %)', n; END IF;
    SELECT next_seq INTO n FROM vc.realtime_stream
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 3 THEN RAISE EXCEPTION 'stream next_seq must advance to 3 (got %)', n; END IF;

    -- R1 P2-4: a terminal generation (now COMPLETED) rejects new durable events.
    BEGIN
        PERFORM vc.append_realtime_event(1, 5000, 1, 'safety.notice', '{}'::jsonb);
        RAISE EXCEPTION 'append to a terminal generation must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%append to a terminal generation must be rejected%' THEN
            RAISE;
        END IF;
        -- expected: cannot append to a terminal generation
    END;

    -- The standalone snapshot endpoint returns the same committed truth.
    SELECT out_status, out_events INTO v_snapstatus, v_events
      FROM vc.read_generation_snapshot(1, 5000);
    IF v_snapstatus <> 'COMPLETED' THEN
        RAISE EXCEPTION 'snapshot endpoint status must be COMPLETED (got %)', v_snapstatus;
    END IF;
    SELECT count(*) INTO n FROM jsonb_array_elements(v_events);
    IF n < 1 THEN
        RAISE EXCEPTION 'snapshot endpoint must return committed durable events';
    END IF;
END $$;
COMMIT;
RESET ROLE;
