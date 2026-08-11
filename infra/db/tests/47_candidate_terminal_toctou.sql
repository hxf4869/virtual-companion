-- 47_candidate_terminal_toctou: a candidate insert already in flight (blocked
-- on the generation row lock) races a concurrent terminalize_generation that
-- wins inside the lock (IN_PROGRESS -> FAILED_FINAL, chat.failed). The late
-- candidate insert must be rejected under its own lock: zero candidate rows
-- for the generation and the terminal state stands (TASK-0098 P2-10: no late
-- candidates into a terminal generation).

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
VALUES (1, 5001, 100, 'gen-ct-1', 'IN_PROGRESS');

DO $$
BEGIN
    PERFORM dblink_connect('sess_l', 'dbname=vc');
    -- V17: dblink session calls insert_generation_candidate, which asserts owner context (P1-04).
    PERFORM dblink_exec('sess_l', 'SET ROLE vc_api');
    PERFORM dblink_exec('sess_l', 'SET vc.owner_user_id = ''1''');
END $$;

-- Phase 1: hold the generation row lock, launch an in-flight candidate insert
-- that blocks on the lock, then let terminalize_generation win inside the lock.
BEGIN;
-- V17: terminalize_generation requires server-trusted owner context (P1-04).
SET LOCAL vc.owner_user_id = '1';
SELECT 1 FROM vc.generation g WHERE g.owner_user_id = 1 AND g.id = 5001 FOR UPDATE;
DO $$
BEGIN
    PERFORM dblink_send_query('sess_l',
        $q$SELECT * FROM vc.insert_generation_candidate(1, 5001, 'late candidate', false)$q$);
    -- terminalize wins inside the lock (same transaction already holds it).
    PERFORM vc.terminalize_generation(1, 5001, 'FAILED_FINAL', 'chat.failed', '{"reason":"provider error"}'::jsonb);
END $$;
COMMIT;

-- Phase 2: the in-flight candidate insert now acquires the lock, re-checks the
-- terminal state under its lock and must be rejected; zero rows may remain.
DO $$
DECLARE
    n        int;
    v_status text;
BEGIN
    SELECT status INTO v_status FROM vc.generation WHERE owner_user_id = 1 AND id = 5001;
    IF v_status <> 'FAILED_FINAL' THEN
        RAISE EXCEPTION 'expected FAILED_FINAL (got %)', v_status;
    END IF;
    BEGIN
        PERFORM * FROM dblink_get_result('sess_l') AS t(out_candidate_id bigint);
        RAISE EXCEPTION 'late candidate insert must be rejected';
    EXCEPTION WHEN OTHERS THEN
        IF position('cannot insert into a terminal generation' in SQLERRM) = 0 THEN
            RAISE EXCEPTION 'unexpected loser error: %', SQLERRM;
        END IF;
    END;
    SELECT count(*) INTO n FROM vc.generation_candidate WHERE owner_user_id = 1 AND generation_id = 5001;
    IF n <> 0 THEN RAISE EXCEPTION 'terminal winner must leave zero candidate rows (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5001 AND event_type = 'chat.failed';
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one chat.failed expected (got %)', n; END IF;
    PERFORM dblink_disconnect('sess_l');
END $$;
