-- 174_export_recover_token_rotation: V139 — explicit recovery of the owner's
-- most recent UNCLAIMED export copy (vc.recover_export_request).
--
-- Covers, as vc_api under a server-trusted owner context:
--   * recover re-arms the SAME row — the newest claimable one, so a PENDING
--     copy wins over an older READY copy — with the digest of the new token
--     (never the plaintext); the superseded token no longer consumes while
--     the re-issued one consumes exactly once; status is not changed;
--   * a consumed row (digest NULL) is never re-armed; after the newest copy is
--     consumed a FRESH call falls back to the older still-unclaimed copy;
--   * nothing claimable returns zero rows (existence undisclosed);
--   * a foreign owner id and a missing owner context RAISE; vc_worker cannot
--     execute the function at all (EXECUTE granted to vc_api only);
--   * REAL lock timeline 1 (two connections): consume_export holds the row
--     lock of the newest copy while recover runs on a second connection —
--     recover pins that copy from its snapshot, must WAIT on its row lock
--     (asserted via pg_locks) and, once the consume commits, the re-check
--     yields ZERO rows: it does not slide to the older READY copy, which is
--     left untouched;
--   * REAL lock timeline 2: an in-flight recover holds the V113 owner barrier,
--     so vc.request_account_deletion_current must WAIT (lock timeout); once the
--     intent commits, recover is refused with "deletion is in progress" and
--     nothing rotates.
--
-- PG 18's dblink refuses NEW connections initiated by a non-superuser, so the
-- cross-connection sessions are established FIRST as the migration owner and
-- REUSED after SET ROLE (163 pattern). psql does NOT interpolate :variables
-- inside dollar-quoted bodies: remote BEGIN / binding / sends run as plain
-- statements and ids travel through session GUCs.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.export_upload_intent, vc.consent_record,
         vc.entitlement_snapshot, vc.service_class_assignment, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.work_item,
         vc.outbox_event, vc.realtime_event, vc.account_deletion_intent,
         vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice-recover', 'x', 'USER', 'ACTIVE', 'alice');

SELECT dblink_connect('rec', 'dbname=vc user=postgres password=vc');
SELECT dblink_connect('coord', 'dbname=vc user=postgres password=vc');

-- Remote owner bindings (connection/transaction bound: each remote session
-- evaluates the proof against ITS OWN backend pid / xact id).
\set rec_bind 'DO $rb$ BEGIN PERFORM vc.set_owner_context(1, ''r1'', encode(vc.hmac(convert_to(''vc-owner-binding-v1|1|'' || pg_backend_pid() || ''|'' || pg_current_xact_id() || ''|r1'', ''UTF8''), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), ''UTF8''), ''sha256''), ''hex'')); END $rb$;'
\set coord_bind 'DO $rb$ BEGIN PERFORM vc.set_owner_context(1, ''c9'', encode(vc.hmac(convert_to(''vc-owner-binding-v1|1|'' || pg_backend_pid() || ''|'' || pg_current_xact_id() || ''|c9'', ''UTF8''), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), ''UTF8''), ''sha256''), ''hex'')); END $rb$;'

-- ---------------------------------------------------------------------------
-- Part A: functional contract on one owner connection.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'a1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'a1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_older   bigint;
    v_newer   bigint;
    v_id      bigint;
    v_status  text;
    v_payload text;
    n         integer;
BEGIN
    -- An older READY copy and a newer PENDING copy.
    v_older := vc.create_export_request(1, 'tok-older');
    PERFORM vc.complete_export(1, v_older, '{"older":true}', now() + interval '1 hour');
    v_newer := vc.create_export_request(1, 'tok-newer');

    -- Recover pins the newest claimable row (the PENDING one) and keeps status.
    SELECT out_id, out_status INTO v_id, v_status
      FROM vc.recover_export_request(1, 'tok-r1');
    IF v_id IS DISTINCT FROM v_newer OR v_status IS DISTINCT FROM 'PENDING' THEN
        RAISE EXCEPTION 'recover must re-arm the newest (PENDING) copy %, got %/%', v_newer, v_id, v_status;
    END IF;
    -- Still PENDING: nothing downloads yet.
    SELECT count(*) INTO n FROM vc.consume_export(1, v_newer, 'tok-r1');
    IF n <> 0 THEN
        RAISE EXCEPTION 'a PENDING copy must not consume';
    END IF;

    -- Seal: the superseded token is dead, the re-issued one consumes once.
    PERFORM vc.complete_export(1, v_newer, '{"newer":true}', now() + interval '1 hour');
    SELECT count(*) INTO n FROM vc.consume_export(1, v_newer, 'tok-newer');
    IF n <> 0 THEN
        RAISE EXCEPTION 'the superseded token must not consume';
    END IF;
    SELECT out_payload INTO v_payload FROM vc.consume_export(1, v_newer, 'tok-r1');
    IF v_payload IS DISTINCT FROM '{"newer":true}' THEN
        RAISE EXCEPTION 'the re-issued token must consume the same payload once';
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_newer, 'tok-r1');
    IF n <> 0 THEN
        RAISE EXCEPTION 'the re-issued token must be one-time';
    END IF;

    -- The consumed newest copy is never re-armed; a FRESH call falls back to
    -- the older still-unclaimed copy, whose own original token then dies.
    SELECT out_id, out_status INTO v_id, v_status
      FROM vc.recover_export_request(1, 'tok-r2');
    IF v_id IS DISTINCT FROM v_older OR v_status IS DISTINCT FROM 'READY' THEN
        RAISE EXCEPTION 'recover must fall back to the older unclaimed copy %, got %/%', v_older, v_id, v_status;
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_newer, 'tok-r2');
    IF n <> 0 THEN
        RAISE EXCEPTION 'a consumed copy must stay consumed';
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_older, 'tok-older');
    IF n <> 0 THEN
        RAISE EXCEPTION 'the older copy''s superseded token must not consume';
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_older, 'tok-r2');
    IF n <> 1 THEN
        RAISE EXCEPTION 'the older copy''s re-issued token must consume once';
    END IF;

    -- Nothing claimable: zero rows, no error (existence undisclosed).
    SELECT count(*) INTO n FROM vc.recover_export_request(1, 'tok-r3');
    IF n <> 0 THEN
        RAISE EXCEPTION 'nothing claimable must return zero rows (got %)', n;
    END IF;

    -- A foreign owner id RAISEs (trusted-owner assertion).
    BEGIN
        PERFORM * FROM vc.recover_export_request(2, 'tok-x');
        RAISE EXCEPTION 'foreign owner id unexpectedly passed the trusted-owner assertion';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%foreign owner id unexpectedly passed the trusted-owner assertion%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- At rest only digests exist — never a plaintext token (superuser read).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE download_token_hash IN ('tok-older', 'tok-newer', 'tok-r1', 'tok-r2', 'tok-r3')) THEN
        RAISE EXCEPTION 'download_token_hash must store digests, not plaintext tokens';
    END IF;
END $$;

-- A non-vc_api role must NOT be able to call the function.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.recover_export_request(1, 'tok-x');
    RAISE EXCEPTION 'vc_worker unexpectedly executed recover_export_request';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;

-- Recover without a server-trusted owner context RAISEs (fail closed).
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM * FROM vc.recover_export_request(1, 'tok-x');
    RAISE EXCEPTION 'recover_export_request without owner context unexpectedly succeeded';
EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected: current_owner_id() is NULL, assertion fails closed
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Part B setup: two fresh READY copies — C (older) and D (newer). Their ids
-- travel through session GUCs.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'b0', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b0', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_c bigint;
    v_d bigint;
BEGIN
    v_c := vc.create_export_request(1, 'tok-c');
    PERFORM vc.complete_export(1, v_c, '{"c":true}', now() + interval '1 hour');
    v_d := vc.create_export_request(1, 'tok-d');
    PERFORM vc.complete_export(1, v_d, '{"d":true}', now() + interval '1 hour');
    PERFORM set_config('vc.r214_c', v_c::text, false);
    PERFORM set_config('vc.r214_d', v_d::text, false);
END $$;
COMMIT;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Timeline 1, step 1 (DOWNLOAD, this connection): consume the newest copy D
-- and keep the transaction open — D's row lock is held and its NULL digest
-- is not yet visible to anyone else.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'b1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'b1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n
      FROM vc.consume_export(1, current_setting('vc.r214_d')::bigint, 'tok-d');
    IF n <> 1 THEN
        RAISE EXCEPTION 'timeline 1: the in-flight consume of the newest copy must succeed';
    END IF;
END $$;

-- Step 2 (RECOVER, second REAL connection, asynchronous): recover pins D from
-- its snapshot (the consume is uncommitted) and must block on D's row lock.
SELECT dblink_exec('rec', 'BEGIN');
SELECT dblink_exec('rec', :'rec_bind');
SELECT set_config('vc.r214_rec_pid', t.pid::text, false)
  FROM dblink('rec', 'SELECT pg_backend_pid()') AS t(pid int);
SELECT dblink_send_query('rec', 'SELECT out_id FROM vc.recover_export_request(1, ''tok-race'')');
DO $$
DECLARE
    v_pid   int := current_setting('vc.r214_rec_pid')::int;
    blocked boolean := false;
    i       integer;
BEGIN
    FOR i IN 1..200 LOOP
        IF EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid = v_pid AND NOT l.granted) THEN
            blocked := true;
            EXIT;
        END IF;
        PERFORM pg_sleep(0.05);
    END LOOP;
    IF NOT blocked THEN
        RAISE EXCEPTION 'timeline 1: recover did not wait on the pinned candidate''s row lock';
    END IF;
    IF dblink_is_busy('rec') <> 1 THEN
        RAISE EXCEPTION 'timeline 1: recover finished while the consume was still open';
    END IF;
END $$;

-- Step 3: the download commits — D's digest is now NULL for everyone.
COMMIT;
RESET ROLE;

-- Step 4: the blocked recover re-checks D on its locked version and returns
-- ZERO rows — it did not slide to the older copy C.
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM dblink_get_result('rec') AS t(out_id bigint);
    IF n <> 0 THEN
        RAISE EXCEPTION 'timeline 1: recover must return zero rows after losing the race (got %)', n;
    END IF;
    PERFORM * FROM dblink_get_result('rec') AS t(out_id bigint); -- drain
END $$;
SELECT dblink_exec('rec', 'COMMIT');
DO $$
DECLARE
    v_c_hash text;
    v_d_hash text;
BEGIN
    SELECT download_token_hash INTO v_c_hash FROM vc.export_request
     WHERE owner_user_id = 1 AND id = current_setting('vc.r214_c')::bigint;
    SELECT download_token_hash INTO v_d_hash FROM vc.export_request
     WHERE owner_user_id = 1 AND id = current_setting('vc.r214_d')::bigint;
    IF v_d_hash IS NOT NULL THEN
        RAISE EXCEPTION 'timeline 1: the consumed copy must keep a NULL digest';
    END IF;
    IF v_c_hash IS DISTINCT FROM encode(vc.digest(convert_to('tok-c', 'UTF8'), 'sha256'), 'hex') THEN
        RAISE EXCEPTION 'timeline 1: the older copy must be untouched by the losing recover';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Timeline 2, step 1 (RECOVER, this connection, left open): re-arm the
-- remaining claimable copy C and keep the transaction open — the V113 owner
-- barrier is held.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'd1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'd1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT out_id INTO v_id FROM vc.recover_export_request(1, 'tok-hold');
    IF v_id IS DISTINCT FROM current_setting('vc.r214_c')::bigint THEN
        RAISE EXCEPTION 'timeline 2: the remaining claimable copy must be C';
    END IF;
END $$;

-- Step 2 (DELETION, second REAL connection): must WAIT on the barrier —
-- asserted by a real lock timeout on vc.request_account_deletion_current.
SELECT dblink_exec('coord', 'BEGIN');
SELECT dblink_exec('coord', 'SET LOCAL lock_timeout = ''600ms''');
SELECT dblink_exec('coord', :'coord_bind');
DO $$
BEGIN
    BEGIN
        PERFORM dblink_exec('coord', 'DO $rd$ BEGIN PERFORM vc.request_account_deletion_current(); END $rd$;');
        RAISE EXCEPTION 'timeline 2: deletion did not wait for the in-flight recover';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%did not wait%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'timeline 2: unexpected deletion error: %', SQLERRM;
        END IF;
    END;
    PERFORM dblink_exec('coord', 'ROLLBACK');
END $$;

-- Step 3: the in-flight recover is abandoned — the barrier releases and its
-- rotation never became visible.
ROLLBACK;
RESET ROLE;

-- Step 4 (DELETION retries): with the barrier free the intent commits.
SELECT dblink_exec('coord', 'BEGIN');
SELECT dblink_exec('coord', :'coord_bind');
DO $$
DECLARE
    n integer;
BEGIN
    PERFORM dblink_exec('coord', 'DO $rd$ BEGIN PERFORM vc.request_account_deletion_current(); END $rd$;');
    PERFORM dblink_exec('coord', 'COMMIT');
    SELECT count(*) INTO n FROM vc.account_deletion_intent WHERE account_id = 1;
    IF n <> 1 THEN
        RAISE EXCEPTION 'timeline 2: the retried deletion must commit the intent';
    END IF;
END $$;

-- Step 5: recover is refused atomically under the intent.
BEGIN;
SELECT vc.set_owner_context(1, 'd5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'd5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    BEGIN
        PERFORM * FROM vc.recover_export_request(1, 'tok-dead');
        RAISE EXCEPTION 'timeline 2: recover under an active deletion intent unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%deletion is in progress%' THEN
            RAISE EXCEPTION 'timeline 2: unexpected recover error: %', SQLERRM;
        END IF;
    END;
END $$;
ROLLBACK;
RESET ROLE;

-- C still carries its pre-timeline digest: neither the abandoned nor the
-- refused recover rotated it.
DO $$
DECLARE
    v_hash text;
BEGIN
    SELECT download_token_hash INTO v_hash FROM vc.export_request
     WHERE owner_user_id = 1 AND id = current_setting('vc.r214_c')::bigint;
    IF v_hash IS DISTINCT FROM encode(vc.digest(convert_to('tok-c', 'UTF8'), 'sha256'), 'hex') THEN
        RAISE EXCEPTION 'timeline 2: C must keep its original digest';
    END IF;
END $$;

-- Leave no deletion intent (or the identity rows this test created) behind:
-- the lexicographic successors (17_, 18_, 19_, …) predate V103 and never
-- truncate vc.account_deletion_intent, so a surviving intent for owner 1 would
-- trip every later owner-1 write (163 pattern).
DELETE FROM vc.account_deletion_intent WHERE account_id = 1;
DELETE FROM vc.identity_auth_event WHERE account_id = 1;
DELETE FROM vc.identity_account WHERE id = 1;

SELECT dblink_disconnect('rec');
SELECT dblink_disconnect('coord');
