-- 49_realtime_seq_concurrent: two independent DB sessions concurrently append
-- durable events to, and advance the sequence of, the same generation
-- (TASK-0100 P2-07). The atomic UPDATE (stream row lock) in
-- append_realtime_event and advance_realtime_seq serializes the allocation:
-- concurrent appends receive strictly unique increasing event_seq (no
-- unique-key collision), concurrent advances accumulate every increment (no
-- lost update).
--
-- The main session holds no stream lock while waiting on dblink results (an
-- invisible DblinkGetResult wait cannot be detected by the deadlock detector).

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

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
VALUES (1, 5000, 100, 'gen-seq-1', 'IN_PROGRESS');

DO $$
BEGIN
    PERFORM dblink_connect('sess_a', 'dbname=vc');
    PERFORM dblink_connect('sess_b', 'dbname=vc');
    -- V17: dblink sessions call append_realtime_event/advance_realtime_seq, which assert owner context (P1-04).
    PERFORM dblink_exec('sess_a', 'SET ROLE vc_api');
    PERFORM dblink_exec('sess_a', 'SET vc.owner_user_id = ''1''');
    PERFORM dblink_exec('sess_b', 'SET ROLE vc_api');
    PERFORM dblink_exec('sess_b', 'SET vc.owner_user_id = ''1''');
END $$;

DO $$
DECLARE
    seq_a   bigint;
    seq_b   bigint;
    n       int;
    v_next  bigint;
BEGIN
    -- Two independent sessions, each acting as a vc_api client, race to append
    -- a durable event. The atomic UPDATE serializes them: both succeed and get
    -- strictly unique seqs {1,2}; no unique-key collision is possible. Each
    -- connection is drained (dblink_get_result until NULL) before reuse: a
    -- connection with an undrained result rejects the next send.
    PERFORM dblink_send_query('sess_a',
        $q$SELECT vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{"s":"a"}'::jsonb)$q$);
    PERFORM dblink_send_query('sess_b',
        $q$SELECT vc.append_realtime_event(1, 5000, 1, 'safety.notice', '{"s":"b"}'::jsonb)$q$);
    SELECT t.cnt INTO seq_a FROM dblink_get_result('sess_a') AS t(cnt bigint);
    PERFORM dblink_get_result('sess_a');
    SELECT t.cnt INTO seq_b FROM dblink_get_result('sess_b') AS t(cnt bigint);
    PERFORM dblink_get_result('sess_b');
    IF seq_a IS NULL OR seq_b IS NULL THEN
        RAISE EXCEPTION 'both concurrent appends must succeed (a=%, b=%)', seq_a, seq_b;
    END IF;
    IF seq_a = seq_b OR seq_a + seq_b <> 3 THEN
        RAISE EXCEPTION 'concurrent appends must get strictly unique seqs {1,2} (a=%, b=%)', seq_a, seq_b;
    END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000 AND stream_epoch = 1;
    IF n <> 2 THEN RAISE EXCEPTION 'both concurrent events must persist (got %)', n; END IF;
    SELECT next_seq INTO v_next FROM vc.realtime_stream
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF v_next <> 3 THEN RAISE EXCEPTION 'stream next_seq must be 3 after two appends (got %)', v_next; END IF;

    -- Two concurrent advances of +2 each: every increment accumulates. The
    -- atomic UPDATE yields next_seq 5 and 7 (in either order); +4 total.
    PERFORM dblink_send_query('sess_a', $q$SELECT vc.advance_realtime_seq(1, 5000, 2)$q$);
    PERFORM dblink_send_query('sess_b', $q$SELECT vc.advance_realtime_seq(1, 5000, 2)$q$);
    SELECT t.cnt INTO seq_a FROM dblink_get_result('sess_a') AS t(cnt bigint);
    PERFORM dblink_get_result('sess_a');
    SELECT t.cnt INTO seq_b FROM dblink_get_result('sess_b') AS t(cnt bigint);
    PERFORM dblink_get_result('sess_b');
    IF NOT ((seq_a = 5 AND seq_b = 7) OR (seq_a = 7 AND seq_b = 5)) THEN
        RAISE EXCEPTION 'concurrent advances must yield 5 and 7 (a=%, b=%)', seq_a, seq_b;
    END IF;
    SELECT next_seq INTO v_next FROM vc.realtime_stream
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF v_next <> 7 THEN RAISE EXCEPTION 'stream next_seq must be 7 after +4 total (got %)', v_next; END IF;

    PERFORM dblink_disconnect('sess_a');
    PERFORM dblink_disconnect('sess_b');
END $$;
