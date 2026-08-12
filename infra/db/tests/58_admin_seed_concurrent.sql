-- 58_admin_seed_concurrent: two independent DB sessions concurrently call
-- vc.identity_admin_seed at bootstrap (P2-13). The V19 transaction-scoped
-- advisory lock serializes the check-then-insert: exactly one session creates
-- the bootstrap ADMIN and the other observes it and no-ops, returning the same
-- id. Asserts a single ADMIN account exists after the race, both calls return
-- the same non-null id, the winner is one of the two intended usernames, and
-- the vc_user ownership root and ACCOUNT_CREATE audit are written exactly once.
--
-- The connect runs in its own autocommit statement before the send block: the
-- main session holds no identity lock while waiting on dblink results.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

-- Open the two racing sessions that will concurrently seed the bootstrap ADMIN.
DO $$
BEGIN
    PERFORM dblink_connect('sess_a', 'dbname=vc');
    PERFORM dblink_connect('sess_b', 'dbname=vc');
END $$;

DO $$
DECLARE
    v_id_a   bigint;
    v_id_b   bigint;
    n        int;
BEGIN
    -- Two independent sessions concurrently call identity_admin_seed with
    -- different intended usernames. The advisory lock (V19) serializes them:
    -- the winner creates the bootstrap ADMIN; the loser's SELECT (after the
    -- winner's transaction releases the lock) observes it and no-ops, returning
    -- the same id. The main session holds no lock here, so both remote seeds
    -- contend for the advisory lock and exactly one wins.
    PERFORM dblink_send_query('sess_a',
        $q$SELECT vc.identity_admin_seed('race-admin-a', '$2a$10$seed.hash.placeholder.a', 'Race Admin A') AS seed_id$q$);
    PERFORM dblink_send_query('sess_b',
        $q$SELECT vc.identity_admin_seed('race-admin-b', '$2a$10$seed.hash.placeholder.b', 'Race Admin B') AS seed_id$q$);

    SELECT t.seed_id INTO v_id_a FROM dblink_get_result('sess_a') AS t(seed_id bigint);
    SELECT t.seed_id INTO v_id_b FROM dblink_get_result('sess_b') AS t(seed_id bigint);

    -- Both calls must succeed (non-null) and return the same id (winner's).
    IF v_id_a IS NULL OR v_id_b IS NULL THEN
        RAISE EXCEPTION 'both concurrent seeds must return a non-null id (a=%, b=%)', v_id_a, v_id_b;
    END IF;
    IF v_id_a <> v_id_b THEN
        RAISE EXCEPTION 'both concurrent seeds must return the same id, got a=% vs b=%', v_id_a, v_id_b;
    END IF;

    -- Exactly one ADMIN account exists after the race (no duplicate bootstrap).
    SELECT count(*) INTO n FROM vc.identity_account WHERE role = 'ADMIN';
    IF n <> 1 THEN
        RAISE EXCEPTION 'exactly one ADMIN must exist after concurrent seed, got %', n;
    END IF;

    -- The single ADMIN is one of the two racing usernames (the winner's); the
    -- loser's username never became an account.
    SELECT count(*) INTO n FROM vc.identity_account
     WHERE role = 'ADMIN' AND username IN ('race-admin-a', 'race-admin-b');
    IF n <> 1 THEN
        RAISE EXCEPTION 'exactly one of the racing usernames must be the ADMIN, got %', n;
    END IF;

    -- The ownership root and ACCOUNT_CREATE audit are written exactly once.
    PERFORM 1 FROM vc.vc_user WHERE id = v_id_a;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'the bootstrap ADMIN must own a vc_user root row';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'ACCOUNT_CREATE' AND account_id = v_id_a;
    IF n <> 1 THEN
        RAISE EXCEPTION 'exactly one ACCOUNT_CREATE audit expected for the bootstrap ADMIN, got %', n;
    END IF;

    PERFORM dblink_disconnect('sess_a');
    PERFORM dblink_disconnect('sess_b');
END $$;
