-- 21_resume_gap_expired_window: when the client's cursor falls below the
-- retained low-water mark (retained_after_seq), resume returns GAP_EXPIRED and
-- no events -- the client must recover via terminal snapshot and may never
-- fabricate the missing deltas (INV-RT-001). A cursor at or above the boundary
-- still resumes normally.

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
VALUES (1, 5000, 100, 'gen-gap-1', 'IN_PROGRESS');

SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    v_disp   text;
    v_events jsonb;
    v_retained bigint;
BEGIN
    -- Three durable events (seq 1,2,3). Deltas (non-durable) aged out of the
    -- window up to seq 2, advancing the retained boundary.
    PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{}'::jsonb);
    PERFORM vc.append_realtime_event(1, 5000, 1, 'safety.notice', '{}'::jsonb);
    PERFORM vc.append_realtime_event(1, 5000, 1, 'service.mode.changed', '{}'::jsonb);
    SELECT vc.expire_realtime_window(1, 5000, 2) INTO v_retained;
    IF v_retained <> 2 THEN
        RAISE EXCEPTION 'retained_after_seq must advance to 2 (got %)', v_retained;
    END IF;

    -- Cursor 1 is below the retained boundary 2 => unrecoverable gap.
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 1, 1);
    IF v_disp <> 'GAP_EXPIRED' THEN
        RAISE EXCEPTION 'cursor below retained window must be GAP_EXPIRED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 0 THEN
        RAISE EXCEPTION 'GAP_EXPIRED must return no events (missing deltas never fabricated)';
    END IF;

    -- Cursor exactly at the boundary 2 still resumes (events strictly after 2).
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 1, 2);
    IF v_disp <> 'RESUMED' THEN
        RAISE EXCEPTION 'cursor at retained boundary must RESUMED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 1 THEN
        RAISE EXCEPTION 'resume(after=2) must return exactly 1 event (got %)', v_events;
    END IF;
    IF (v_events->0->>'eventSeq')::int <> 3 THEN
        RAISE EXCEPTION 'resume(after=2) must return seq 3';
    END IF;

    -- expire is monotonic: a lower up_to_seq never moves the boundary backwards.
    SELECT vc.expire_realtime_window(1, 5000, 0) INTO v_retained;
    IF v_retained <> 2 THEN
        RAISE EXCEPTION 'retained_after_seq must not move backwards (got %)', v_retained;
    END IF;
END $$;
COMMIT;
RESET ROLE;
