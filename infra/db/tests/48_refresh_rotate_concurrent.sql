-- 48_refresh_rotate_concurrent: two independent DB sessions concurrently
-- rotate the same live refresh token (TASK-0099 P1-06). The token row lock
-- (SELECT ... FOR UPDATE OF t) plus the live-state re-check under the lock in
-- vc.identity_refresh_token_rotate serialize the single-use transition:
-- exactly one session wins and inserts its successor; the loser fails closed
-- (zero rows) and writes nothing. Asserts a single live successor whose
-- token_hash is exactly the winner's new hash, the old token revoked, the
-- loser's hash absent (no hidden session) and no other rows for the account.
--
-- The token issue runs in its own autocommit statement BEFORE the send block:
-- the main session must not hold any identity lock while waiting on dblink
-- results (an invisible DblinkGetResult wait cannot be detected by the
-- PostgreSQL deadlock detector).

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.memory_evidence, vc.memory_item, vc.realtime_ticket, vc.realtime_stream,
         vc.realtime_event, vc.quota_ledger_entry, vc.generation_usage,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

-- Seed the ADMIN and issue exactly one live refresh token (autocommit), then
-- open the two racing sessions acting as vc_api clients.
DO $$
DECLARE v_admin bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-admin', '$2a$10$seed.hash.placeholder', 'Root Admin') INTO v_admin;
    PERFORM vc.identity_refresh_token_issue(v_admin, encode(sha256('rt-race-old'::bytea), 'hex'), now() + interval '7 days');
    PERFORM dblink_connect('sess_a', 'dbname=vc');
    PERFORM dblink_connect('sess_b', 'dbname=vc');
    PERFORM dblink_exec('sess_a', 'SET ROLE vc_api');
    PERFORM dblink_exec('sess_b', 'SET ROLE vc_api');
END $$;

DO $$
DECLARE
    v_admin   bigint;
    v_old_hash text := encode(sha256('rt-race-old'::bytea), 'hex');
    v_new_a   text := encode(sha256('rt-race-new-a'::bytea), 'hex');
    v_new_b   text := encode(sha256('rt-race-new-b'::bytea), 'hex');
    cnt_a     bigint;
    cnt_b     bigint;
    n         int;
    v_live    text;
BEGIN
    SELECT id INTO v_admin FROM vc.identity_account WHERE username = 'root-admin';

    -- Two independent sessions, each acting as a vc_api client, race to rotate
    -- the same token. The main session holds no identity lock here, so both
    -- remote rotates contend for the token row lock and exactly one wins.
    PERFORM dblink_send_query('sess_a',
        $q$SELECT count(*) FROM vc.identity_refresh_token_rotate('$q$ || v_old_hash || $q$', '$q$ || v_new_a || $q$', now() + interval '7 days')$q$);
    PERFORM dblink_send_query('sess_b',
        $q$SELECT count(*) FROM vc.identity_refresh_token_rotate('$q$ || v_old_hash || $q$', '$q$ || v_new_b || $q$', now() + interval '7 days')$q$);

    SELECT t.cnt INTO cnt_a FROM dblink_get_result('sess_a') AS t(cnt bigint);
    SELECT t.cnt INTO cnt_b FROM dblink_get_result('sess_b') AS t(cnt bigint);

    -- Exactly one winner: the winner's rotate returns the account row (cnt=1),
    -- the loser's returns no rows (cnt=0). Anything else means the race is open.
    IF cnt_a + cnt_b <> 1 THEN
        RAISE EXCEPTION 'exactly one concurrent rotate must win (a=%, b=%)', cnt_a, cnt_b;
    END IF;

    -- Old token revoked exactly once.
    SELECT count(*) INTO n FROM vc.identity_refresh_token
     WHERE token_hash = v_old_hash AND revoked_at IS NOT NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'rotated old token must be revoked exactly once (got %)', n; END IF;

    -- Exactly one live successor, and its hash is the winner's new hash.
    SELECT count(*), min(token_hash) INTO n, v_live FROM vc.identity_refresh_token
     WHERE account_id = v_admin AND revoked_at IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'exactly one live successor expected (got %)', n; END IF;
    IF cnt_a = 1 THEN
        IF v_live <> v_new_a THEN RAISE EXCEPTION 'live successor must be winner a hash, got %', v_live; END IF;
    ELSE
        IF v_live <> v_new_b THEN RAISE EXCEPTION 'live successor must be winner b hash, got %', v_live; END IF;
    END IF;

    -- The loser's hash never landed (no hidden session), and the account holds
    -- exactly two rows in total: the revoked old token plus the one successor.
    IF cnt_a = 1 THEN
        SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_new_b;
    ELSE
        SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE token_hash = v_new_a;
    END IF;
    IF n <> 0 THEN RAISE EXCEPTION 'loser successor hash must not exist (got %)', n; END IF;

    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE account_id = v_admin;
    IF n <> 2 THEN RAISE EXCEPTION 'account must hold exactly old+successor rows (got %)', n; END IF;

    PERFORM dblink_disconnect('sess_a');
    PERFORM dblink_disconnect('sess_b');
END $$;
