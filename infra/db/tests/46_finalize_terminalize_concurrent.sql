-- 46_finalize_terminalize_concurrent: a finalize already in flight (blocked on
-- the generation row lock) loses to a concurrent terminalize_generation that
-- wins inside the lock (FINAL_REVIEW -> OUTPUT_BLOCKED, chat.blocked). The
-- late finalize must fail closed with zero writes: status stays OUTPUT_BLOCKED
-- and no message/usage/quota/outbox row appears; exactly one chat.blocked
-- terminal event exists and zero chat.completed (TASK-0098 P1-03 / INV-GEN-003).

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
VALUES (1, 5000, 100, 'gen-ft-1', 'FINAL_REVIEW');

CREATE TEMP TABLE t_cid(cid bigint);
DO $$
DECLARE cid bigint;
BEGIN
    -- V17: insert_generation_candidate requires server-trusted owner context (P1-04).
    PERFORM vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    SELECT out_candidate_id INTO cid FROM vc.insert_generation_candidate(1, 5000, 'draft', false);
    INSERT INTO t_cid VALUES (cid);
    PERFORM dblink_connect('sess_l', 'dbname=vc');
    -- V17: dblink session calls finalize_generation, which asserts owner context (P1-04).
    -- V17/V27 (TASK-0191): the remote finalize runs as a self-contained
    -- transaction with a valid proof (superuser fixture connection) and then
    -- narrows to the real runtime role for the asserted call.
END $$;

-- Phase 1: hold the generation row lock, launch an in-flight finalize that
-- blocks on the lock, then let terminalize_generation win inside the lock.
BEGIN;
-- V17: terminalize_generation requires server-trusted owner context (P1-04).
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SELECT 1 FROM vc.generation g WHERE g.owner_user_id = 1 AND g.id = 5000 FOR UPDATE;
DO $$
DECLARE cid bigint;
BEGIN
    SELECT t.cid INTO cid FROM t_cid t LIMIT 1;
    PERFORM dblink_send_query('sess_l',
        $q$DO $e$
BEGIN
    PERFORM vc.set_owner_context(1, 'ftx', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'ftx', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
    PERFORM set_config('role', 'vc_api', true);
END
$e$;
DO $b$
BEGIN
    PERFORM * FROM vc.finalize_generation(1, 5000, $q$ || cid::text || $q$, 'late-final', 'provider-a', 10, 5, 0.0010, 'USD', 1, true, NULL);
END
$b$;$q$);
    -- terminalize wins inside the lock (same transaction already holds it).
    PERFORM vc.terminalize_generation(1, 5000, 'OUTPUT_BLOCKED', 'chat.blocked', '{"reason":"safety"}'::jsonb);
END $$;
COMMIT;

-- Phase 2: the in-flight finalize now acquires the lock, re-checks the status
-- under its lock and must fail closed; zero artifacts may remain.
DO $$
DECLARE
    n        int;
    v_status text;
BEGIN
    SELECT status INTO v_status FROM vc.generation WHERE owner_user_id = 1 AND id = 5000;
    IF v_status <> 'OUTPUT_BLOCKED' THEN
        RAISE EXCEPTION 'expected OUTPUT_BLOCKED (got %)', v_status;
    END IF;
    DECLARE
        failed  boolean := false;
        err_msg text := '';
    BEGIN
        LOOP
            BEGIN
                PERFORM * FROM dblink_get_result('sess_l') AS t(dummy text);
            EXCEPTION WHEN OTHERS THEN
                failed := true;
                err_msg := SQLERRM;
                EXIT;
            END;
            EXIT WHEN NOT found;
        END LOOP;
        IF NOT failed THEN
            RAISE EXCEPTION 'in-flight finalize must fail after terminalize won';
        END IF;
        IF position('must be in FINAL_REVIEW (current OUTPUT_BLOCKED)' in err_msg) = 0 THEN
            RAISE EXCEPTION 'unexpected loser error: %', err_msg;
        END IF;
    END;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000 AND event_type = 'chat.blocked';
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one chat.blocked expected (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_event
     WHERE owner_user_id = 1 AND generation_id = 5000 AND event_type = 'chat.completed';
    IF n <> 0 THEN RAISE EXCEPTION 'zero chat.completed expected (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'terminalize winner must leave zero assistant messages (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.generation_usage WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'terminalize winner must leave zero usage rows (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.quota_ledger_entry WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'terminalize winner must leave zero quota ledger rows (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.outbox_event WHERE owner_user_id = 1 AND generation_id = 5000;
    IF n <> 0 THEN RAISE EXCEPTION 'terminalize winner must leave zero outbox rows (got %)', n; END IF;
    PERFORM dblink_disconnect('sess_l');
END $$;
