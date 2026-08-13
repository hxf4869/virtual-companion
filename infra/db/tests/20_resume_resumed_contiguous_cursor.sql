-- 20_resume_resumed_contiguous_cursor: a resume on a non-terminal generation
-- whose cursor is within the retained window returns RESUMED plus the durable
-- events strictly after the cursor, envelope-encoded and ordered by event_seq.
-- event_seq is monotonic per (generation, epoch) and the client advances only
-- the last contiguous sequence (INV-RT-001).

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
VALUES (1, 5000, 100, 'gen-resume-1', 'IN_PROGRESS');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_seq1   bigint;
    v_seq2   bigint;
    v_seq3   bigint;
    v_disp   text;
    v_events jsonb;
    v_snap   jsonb;
    n        int;
BEGIN
    -- Append three durable events; their event_seq must be monotonic 1,2,3.
    SELECT vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{"v":1}'::jsonb) INTO v_seq1;
    SELECT vc.append_realtime_event(1, 5000, 1, 'safety.notice', '{"v":2}'::jsonb) INTO v_seq2;
    SELECT vc.append_realtime_event(1, 5000, 1, 'service.mode.changed', '{"v":3}'::jsonb) INTO v_seq3;
    IF NOT (v_seq1 < v_seq2 AND v_seq2 < v_seq3) THEN
        RAISE EXCEPTION 'event_seq must be monotonic (got %,%,%)', v_seq1, v_seq2, v_seq3;
    END IF;
    IF v_seq1 <> 1 THEN
        RAISE EXCEPTION 'first event_seq must start at 1 (got %)', v_seq1;
    END IF;

    -- Resume from cursor 0: every durable event, envelope-encoded, ordered.
    SELECT out_disposition, out_events, out_snapshot INTO v_disp, v_events, v_snap
      FROM vc.resume_stream(1, 5000, 1, 0);
    IF v_disp <> 'RESUMED' THEN
        RAISE EXCEPTION 'resume(after=0) must be RESUMED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 3 THEN
        RAISE EXCEPTION 'resume(after=0) must return 3 events (got %)', v_events;
    END IF;
    -- Envelope carries the required fields; events ordered by eventSeq.
    IF (v_events->0->>'eventSeq')::int <> 1 OR (v_events->2->>'eventSeq')::int <> 3 THEN
        RAISE EXCEPTION 'events must be ordered by eventSeq ascending';
    END IF;
    IF v_events->0->>'event' IS NULL OR v_events->0->>'streamEpoch' IS NULL
       OR v_events->0->>'committedAt' IS NULL OR v_events->0->>'payload' IS NULL THEN
        RAISE EXCEPTION 'envelope must carry event/streamEpoch/committedAt/payload';
    END IF;
    IF v_snap IS NOT NULL AND v_snap <> 'null'::jsonb THEN
        RAISE EXCEPTION 'RESUMED must not return a snapshot';
    END IF;

    -- Resume from cursor 1: only the events strictly after seq 1.
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 1, 1);
    IF v_disp <> 'RESUMED' THEN
        RAISE EXCEPTION 'resume(after=1) must be RESUMED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 2 THEN
        RAISE EXCEPTION 'resume(after=1) must return 2 events (got %)', v_events;
    END IF;
    IF (v_events->0->>'eventSeq')::int <> 2 THEN
        RAISE EXCEPTION 'resume(after=1) first event must be seq 2';
    END IF;

    -- Resume from the high cursor: no newer events => RESUMED with empty list.
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 1, v_seq3);
    IF v_disp <> 'RESUMED' THEN
        RAISE EXCEPTION 'resume at high cursor must be RESUMED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 0 THEN
        RAISE EXCEPTION 'resume at high cursor must return no events';
    END IF;

    -- The client only ever advances: each resume returns a tail the client can
    -- append contiguously; seqs never go backwards.
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000 AND stream_epoch = 1;
    IF n <> 3 THEN
        RAISE EXCEPTION 'exactly 3 durable events must be persisted (got %)', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;
