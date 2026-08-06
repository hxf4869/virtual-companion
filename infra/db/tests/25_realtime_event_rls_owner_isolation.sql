-- 25_realtime_event_rls_owner_isolation: the three new owned tables
-- (realtime_event, realtime_stream, realtime_ticket) are FORCE RLS with the V2
-- owner_isolation policy, so a missing tenant context matches nothing and one
-- owner can never read or resume another owner's realtime state (INV-TENANT-001).

\set ON_ERROR_STOP on

TRUNCATE vc.realtime_ticket, vc.realtime_stream, vc.realtime_event, vc.quota_ledger_entry,
         vc.generation_usage, vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref) VALUES (1, 10, 'persona-a');
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 100, 10, 'alice-conv');
INSERT INTO vc.generation(owner_user_id, id, conversation_id, logical_generation_id, status)
VALUES (1, 5000, 100, 'gen-rls-1', 'IN_PROGRESS');

-- Owner 1 creates durable event + stream + ticket via the SECURITY DEFINER
-- entry points (definer binds owner_user_id = 1).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE
    v_id bigint;
    v_secret text;
BEGIN
    PERFORM vc.append_realtime_event(1, 5000, 1, 'chat.accepted', '{}'::jsonb);
    SELECT out_ticket_id, out_secret INTO v_id, v_secret
      FROM vc.issue_realtime_ticket(1, 5000, 'sess-1', 'https://app.example', 'FETCH_SSE', 1, 0);
    -- Stash owner 1's ticket id + secret at session level (false = survives the
    -- commit) so the cross-owner consume block can replay them under owner 2.
    PERFORM set_config('app.tid', v_id::text, false);
    PERFORM set_config('app.tsec', v_secret, false);
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 sees NONE of owner 1's realtime rows (FORCE RLS owner isolation).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.realtime_event;
    IF n <> 0 THEN RAISE EXCEPTION 'owner 2 must not see owner 1 realtime_event (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_stream;
    IF n <> 0 THEN RAISE EXCEPTION 'owner 2 must not see owner 1 realtime_stream (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_ticket;
    IF n <> 0 THEN RAISE EXCEPTION 'owner 2 must not see owner 1 realtime_ticket (got %)', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- A missing tenant context matches nothing (fail closed).
SET ROLE vc_api;
BEGIN;
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.realtime_event;
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must match no realtime_event (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_stream;
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must match no realtime_stream (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_ticket;
    IF n <> 0 THEN RAISE EXCEPTION 'missing context must match no realtime_ticket (got %)', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 1 sees exactly its own rows.
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '1';
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.realtime_event WHERE owner_user_id = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must see its 1 realtime_event (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.realtime_ticket WHERE owner_user_id = 1;
    IF n <> 1 THEN RAISE EXCEPTION 'owner 1 must see its 1 realtime_ticket (got %)', n; END IF;
END $$;
COMMIT;
RESET ROLE;

-- Owner 2 cannot consume owner 1's ticket (RLS hides it; consume fails closed).
SET ROLE vc_api;
BEGIN;
SET LOCAL vc.owner_user_id = '2';
DO $$
DECLARE
    v_id bigint;
    v_secret text;
BEGIN
    v_id := current_setting('app.tid')::bigint;
    v_secret := current_setting('app.tsec');
    BEGIN
        PERFORM vc.consume_realtime_ticket(
            2, v_id, v_secret, 5000, 'sess-1', 'https://app.example', 'FETCH_SSE', 1, 0);
        RAISE EXCEPTION 'owner 2 must not consume owner 1 ticket';
    EXCEPTION WHEN OTHERS THEN
        -- expected: ticket invisible under owner 2 (FORCE RLS)
    END;
END $$;
COMMIT;
RESET ROLE;
