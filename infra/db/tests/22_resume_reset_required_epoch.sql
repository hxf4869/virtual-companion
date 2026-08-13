-- 22_resume_reset_required_epoch: when the authoritative generation epoch has
-- advanced (reset_stream_epoch), a resume carrying the stale epoch returns
-- RESET_REQUIRED -- the client must discard uncommitted draft and reset. A
-- resume on the new epoch behaves as a fresh stream (INV-RT-001).

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
VALUES (1, 5000, 100, 'gen-reset-1', 'IN_PROGRESS');

-- SET ROLE vc_api;  (moved below establish as SET LOCAL ROLE, TASK-0191)
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_disp    text;
    v_events  jsonb;
    v_newepoch bigint;
    v_genepoch bigint;
    v_seq     bigint;
BEGIN
    -- Stream starts at epoch 1; appending binds to that epoch.
    SELECT vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{}'::jsonb) INTO v_seq;
    IF v_seq <> 1 THEN RAISE EXCEPTION 'first event_seq must be 1 (got %)', v_seq; END IF;

    -- A reset bumps the authoritative epoch and clears the cursor.
    SELECT vc.reset_stream_epoch(1, 5000) INTO v_newepoch;
    IF v_newepoch <> 2 THEN
        RAISE EXCEPTION 'reset must advance epoch to 2 (got %)', v_newepoch;
    END IF;
    SELECT stream_epoch INTO v_genepoch FROM vc.generation
     WHERE owner_user_id = 1 AND id = 5000;
    IF v_genepoch <> 2 THEN
        RAISE EXCEPTION 'generation.stream_epoch must track the reset (got %)', v_genepoch;
    END IF;

    -- Stale epoch => RESET_REQUIRED, no events.
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 1, 0);
    IF v_disp <> 'RESET_REQUIRED' THEN
        RAISE EXCEPTION 'stale epoch must be RESET_REQUIRED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 0 THEN
        RAISE EXCEPTION 'RESET_REQUIRED must return no events';
    END IF;

    -- After reset, appending at the stale epoch is rejected.
    BEGIN
        PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.delta', '{}'::jsonb);
        RAISE EXCEPTION 'append at stale epoch unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        -- expected: stream_epoch mismatch
    END;

    -- Fresh epoch resumes as a new stream (next_seq reset to 1).
    SELECT vc.append_realtime_event(1, 5000, 2, 'chat.accepted', '{}'::jsonb) INTO v_seq;
    IF v_seq <> 1 THEN
        RAISE EXCEPTION 'event_seq must restart at 1 after reset (got %)', v_seq;
    END IF;
    SELECT out_disposition, out_events INTO v_disp, v_events
      FROM vc.resume_stream(1, 5000, 2, 0);
    IF v_disp <> 'RESUMED' THEN
        RAISE EXCEPTION 'resume on current epoch must be RESUMED (got %)', v_disp;
    END IF;
    IF jsonb_array_length(v_events) <> 1 THEN
        RAISE EXCEPTION 'resume on current epoch must return the 1 new event';
    END IF;
END $$;
COMMIT;
RESET ROLE;
