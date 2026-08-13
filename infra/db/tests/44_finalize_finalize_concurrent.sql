-- 44_finalize_finalize_concurrent: two independent DB sessions concurrently
-- finalize the same FINAL_REVIEW generation. The generation row lock plus the
-- status re-check under the lock (TASK-0098 P1-03) serializes the terminal
-- transition: exactly one session wins, the loser fails closed and writes
-- nothing. Asserts a single final assistant message, usage row, SETTLE quota
-- entry, chat.completed event and outbox row (INV-GEN-002 / INV-TX-001).
--
-- The candidate insert runs in its own autocommit statement BEFORE the send
-- block: the main session must not hold any generation lock while waiting on
-- dblink results (an invisible DblinkGetResult wait cannot be detected by the
-- PostgreSQL deadlock detector).

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
VALUES (1, 5000, 100, 'gen-ff-1', 'FINAL_REVIEW');

-- Candidate id travels across statements via a session temp table.
CREATE TEMP TABLE t_cid(cid bigint);
DO $$
DECLARE cid bigint;
BEGIN
    -- V17: insert_generation_candidate requires server-trusted owner context (P1-04).
    PERFORM vc.set_owner_context(1, 'q1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'q1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT out_candidate_id INTO cid FROM vc.insert_generation_candidate(1, 5000, 'draft', false);
    INSERT INTO t_cid VALUES (cid);
    PERFORM dblink_connect('sess_a', 'dbname=vc');
    PERFORM dblink_connect('sess_b', 'dbname=vc');
    -- V17/V27 (TASK-0191): each remote business statement is a self-contained
    -- transaction that establishes the owner context with a valid proof (the
    -- remote session is the superuser fixture connection) and then narrows to
    -- the real runtime role for the asserted call. The transaction-local
    -- context cannot leak across the statement boundary.
END $$;

DO $$
DECLARE
    cid   bigint;
    n     int;
    v_msg text;
    ok_a  boolean := false;
    ok_b  boolean := false;
    err_a text;
    err_b text;
BEGIN
    SELECT t.cid INTO cid FROM t_cid t LIMIT 1;

    -- Two independent sessions, each acting as a vc_api client. The main
    -- session holds no generation lock here, so both remote finalizes race
    -- for the row lock and exactly one wins.
    PERFORM dblink_send_query('sess_a',
        $q$DO $e$
BEGIN
    PERFORM vc.set_owner_context(1, 'fna', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'fna', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    PERFORM set_config('role', 'vc_api', true);
END
$e$;
DO $b$
BEGIN
    PERFORM * FROM vc.finalize_generation(1, 5000, $q$ || cid::text || $q$, 'winner-a', 'provider-a', 10, 5, 0.0010, 'USD', 1, true, NULL);
END
$b$;$q$);
    PERFORM dblink_send_query('sess_b',
        $q$DO $e$
BEGIN
    PERFORM vc.set_owner_context(1, 'fnb', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'fnb', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    PERFORM set_config('role', 'vc_api', true);
END
$e$;
DO $b$
BEGIN
    PERFORM * FROM vc.finalize_generation(1, 5000, $q$ || cid::text || $q$, 'winner-b', 'provider-a', 11, 6, 0.0020, 'USD', 1, true, NULL);
END
$b$;$q$);

    BEGIN
        -- Every statement of the remote string is a DO block, so each result
        -- is a single status row; drain the whole stream and only then count
        -- the session as the winner (the loser's business error surfaces
        -- mid-stream and is captured here).
        LOOP
            PERFORM * FROM dblink_get_result('sess_a') AS t(dummy text);
            EXIT WHEN NOT FOUND;
        END LOOP;
        ok_a := true;
    EXCEPTION WHEN OTHERS THEN
        err_a := SQLERRM;
    END;
    BEGIN
        LOOP
            PERFORM * FROM dblink_get_result('sess_b') AS t(dummy text);
            EXIT WHEN NOT FOUND;
        END LOOP;
        ok_b := true;
    EXCEPTION WHEN OTHERS THEN
        err_b := SQLERRM;
    END;

    -- Exactly one winner: both succeeding or both failing means the race is open.
    IF (ok_a AND ok_b) OR (NOT ok_a AND NOT ok_b) THEN
        RAISE EXCEPTION 'exactly one concurrent finalize must win (a=%, b=%, err_a=%, err_b=%)',
            ok_a, ok_b, err_a, err_b;
    END IF;
    -- The loser observed the winner's terminal state under its own lock.
    IF ok_a THEN
        IF position('must be in FINAL_REVIEW (current COMPLETED)' in err_b) = 0 THEN
            RAISE EXCEPTION 'loser error mismatch: %', err_b;
        END IF;
    ELSE
        IF position('must be in FINAL_REVIEW (current COMPLETED)' in err_a) = 0 THEN
            RAISE EXCEPTION 'loser error mismatch: %', err_a;
        END IF;
    END IF;

    -- INV-GEN-002: exactly one final assistant message, bound to the generation.
    SELECT count(*), min(content) INTO n, v_msg FROM vc.message
     WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 1 OR v_msg NOT IN ('winner-a', 'winner-b') THEN
        RAISE EXCEPTION 'exactly one final assistant message expected (got %, %)', n, v_msg;
    END IF;
    -- Exactly one usage row, one SETTLE, one chat.completed, one outbox row.
    SELECT count(*) INTO n FROM vc.generation_usage WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one generation_usage expected (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.quota_ledger_entry
     WHERE owner_user_id = 1 AND generation_id = 5000 AND kind = 'SETTLE';
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one SETTLE expected (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000 AND event_type = 'chat.completed';
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one chat.completed expected (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.outbox_event WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one outbox row expected (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.generation_candidate
     WHERE owner_user_id = 1 AND generation_id = 5000 AND is_final;
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one final candidate expected (got %)', n; END IF;

    PERFORM dblink_disconnect('sess_a');
    PERFORM dblink_disconnect('sess_b');
END $$;
