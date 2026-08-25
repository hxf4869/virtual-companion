-- 165_export_upload_reclaim_protocol: DOGFOOD-STABILIZATION-05 defect I —
-- the V114 fenced upload-intent protocol under REAL two-connection lock
-- contention (psql session + dblink), covering the six mandated timelines:
--
--   A. record → grace expired → sweep-before-put → late put → crash:
--      the CLAIMED tombstone stays reclaimable until the export's terminal
--      cleanup, and the fenced seal can never publish the late pointer;
--   B. stale snapshot → worker READY seal: the claim is lost (row consumed)
--      and the sweeper never owns the sealed object;
--   C. stale snapshot → fail_export_with_object: same fencing for the
--      FAILED-with-pointer fallback;
--   D. deletion cleanup of a not-yet-existing object → late worker put:
--      after the cascade the object has NO record — export_object_has_record
--      is false, which is exactly what the scheduler's prefix audit deletes;
--   E. two schedulers (two REAL connections) racing for one attempt: the
--      single-row claim lets exactly one win, the loser times out on the
--      row lock and then reads the CLAIMED state and skips;
--   F. an actively-leased upload past the creation grace is never listed
--      (lease beats age; renew re-arms it).
--
-- Plus the supplementary validations: the intent key must be bound to THIS
-- owner/export attempt, record refuses a non-PENDING export, and the fence
-- refuses complete_export/fail_export_with_object for a reclaimed attempt
-- with the pointer rolled back.
--
-- PG 18 dblink/psql rules (same as 163): dblink connections are established
-- BEFORE SET ROLE; psql does not interpolate :vars inside dollar-quoted
-- bodies (session GUCs carry ids); dblink_exec cannot run result-returning
-- statements (wrap in remote DO blocks or use dblink()).

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

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob'), (3, 'carol');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (1, 'alice-165', 'x', 'USER', 'ACTIVE', 'alice'),
       (3, 'carol-165', 'x', 'USER', 'ACTIVE', 'carol');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);

-- A fresh PENDING export for owner 1 (id travels via session GUC). Every
-- timeline below creates and terminalizes its OWN export: only ONE export
-- may be PENDING per account (V42 one-in-flight).
BEGIN;
SELECT vc.set_owner_context(1, 'n0', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n0', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-165-a') INTO v_id;
    PERFORM set_config('vc.e1', v_id::text, false);
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- Supplementary validation: the intent key must be THIS owner's and THIS
-- export's attempt key (16-hex fence digest segment).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e1 bigint := current_setting('vc.e1')::bigint;
BEGIN
    -- A key naming ANOTHER owner is rejected.
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e1, 'exports/2/99-aaaaaaaaaaaaaaaa.json');
        RAISE EXCEPTION 'cross-owner key unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not bound%' THEN
            RAISE EXCEPTION 'cross-owner key: unexpected error %', SQLERRM;
        END IF;
    END;
    -- A key naming ANOTHER export of the same owner is rejected.
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e1,
            'exports/1/' || (v_e1 + 1) || '-aaaaaaaaaaaaaaaa.json');
        RAISE EXCEPTION 'export-mismatched key unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not bound%' THEN
            RAISE EXCEPTION 'export-mismatched key: unexpected error %', SQLERRM;
        END IF;
    END;
    -- A non-hex attempt segment is rejected.
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e1, 'exports/1/' || v_e1 || '-short.json');
        RAISE EXCEPTION 'short digest key unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not bound%' THEN
            RAISE EXCEPTION 'short digest key: unexpected error %', SQLERRM;
        END IF;
    END;
    -- The correctly bound key records fine (and re-records resolve the row).
    IF vc.record_export_upload_intent(1, v_e1,
           'exports/1/' || v_e1 || '-aaaaaaaaaaaaaaaa.json')
       <> vc.record_export_upload_intent(1, v_e1,
           'exports/1/' || v_e1 || '-aaaaaaaaaaaaaaaa.json') THEN
        RAISE EXCEPTION 're-record must resolve the same row';
    END IF;
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- Timeline A: record → grace expired → the sweep claims BEFORE the worker's
-- put (object absent — the delete is a no-op) → the worker puts late and
-- crashes → the tombstone re-sweep keeps the late object discoverable, and
-- the fenced seal can never publish the pointer.
-- ---------------------------------------------------------------------------
UPDATE vc.export_upload_intent
   SET lease_expires_at = now() - interval '20 minutes'
 WHERE owner_user_id = 1 AND object_key LIKE '%-aaaaaaaaaaaaaaaa.json';

-- Sweep #1: the claim wins (the object delete itself is application-side).
DO $$
DECLARE
    v_key text;
    v_id  bigint;
BEGIN
    SELECT out_id INTO v_id FROM vc.stale_export_upload_intents(100, 0);
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'A: sweep #1 must list the expired intent';
    END IF;
    v_key := vc.claim_export_upload_intent(1, v_id);
    IF v_key IS DISTINCT FROM 'exports/1/' || current_setting('vc.e1') || '-aaaaaaaaaaaaaaaa.json' THEN
        RAISE EXCEPTION 'A: claim must return the object key, got %', v_key;
    END IF;
    -- A second claim of the SAME row loses (state moved to CLAIMED).
    IF vc.claim_export_upload_intent(1, v_id) IS NOT NULL THEN
        RAISE EXCEPTION 'A: a double claim must lose';
    END IF;
END;
$$;

-- The delayed worker: its re-record of the same attempt key is fenced out,
-- and its READY seal raises with the pointer rolled back (export stays
-- PENDING, no pointer). The plain FAILED terminal afterwards frees the
-- account's one-in-flight slot for the later timelines.
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e1 bigint := current_setting('vc.e1')::bigint;
BEGIN
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e1,
            'exports/1/' || v_e1 || '-aaaaaaaaaaaaaaaa.json');
        RAISE EXCEPTION 'A: fenced re-record unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        -- 07: the refusal now surfaces through the durable object fence
        -- (RECLAIM, held by the claim) or the CLAIMED intent row itself —
        -- either way the attempt is fenced out.
        IF SQLERRM NOT LIKE '%already reclaimed%'
           AND SQLERRM NOT LIKE '%fenced for reclaim%' THEN
            RAISE EXCEPTION 'A: fenced re-record error %', SQLERRM;
        END IF;
    END;
    -- (The put itself is storage-side; from here on the worker only tries to
    -- seal — which the intent-enforcing seal refuses, pointer included.)
    BEGIN
        PERFORM vc.complete_export(1, v_e1, NULL, now() + interval '1 hour',
            'exports/1/' || v_e1 || '-aaaaaaaaaaaaaaaa.json', 123);
        RAISE EXCEPTION 'A: fenced seal unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'A: fenced seal error %', SQLERRM;
        END IF;
    END;
END;
$$;
COMMIT;

-- Before the terminal: the tombstone's daily recheck window semantics (this
-- is what deletes a late-put object while the export is still PENDING). The
-- intent table is SD-only, so the harness reads/ages the row as superuser.
DO $$
DECLARE
    v_id bigint;
    n int;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND state = 'CLAIMED';
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'A: the CLAIMED tombstone must exist';
    END IF;
    PERFORM set_config('vc.a_intent_id', v_id::text, false);
    UPDATE vc.export_upload_intent
       SET claimed_at = now() - interval '20 minutes'
     WHERE id = v_id;
    SELECT count(*) INTO n FROM vc.claimed_export_upload_intents(100, 0);
    IF n <> 1 THEN
        RAISE EXCEPTION 'A: the tombstone re-sweep must list the row, got %', n;
    END IF;
    PERFORM vc.mark_export_upload_intent_swept(1, v_id);
    SELECT count(*) INTO n FROM vc.claimed_export_upload_intents(100, 0);
    IF n <> 0 THEN
        RAISE EXCEPTION 'A: a swept tombstone must leave the daily window, got %', n;
    END IF;
    -- 06: while the export is still PENDING (a live attempt could still seal
    -- through the fence) the tombstone must NOT retire, however old.
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 0 THEN
        RAISE EXCEPTION 'A: a PENDING export must keep its tombstone';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE id = v_id) THEN
        RAISE EXCEPTION 'A: the tombstone row must be retained while PENDING';
    END IF;
END;
$$;

-- Plain FAILED terminalizes the export for the timelines below.
BEGIN;
SELECT vc.set_owner_context(1, 'n2b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n2b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e1 bigint := current_setting('vc.e1')::bigint;
BEGIN
    IF vc.fail_export(1, v_e1, 'export-failed') <> 1 THEN
        RAISE EXCEPTION 'A: the plain FAILED terminal must succeed';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e1 bigint := current_setting('vc.e1')::bigint;
BEGIN
    -- The fenced seal raised INSIDE its transaction and the block then took
    -- the plain FAILED terminal: the row must be FAILED with NO pointer (a
    -- READY status or a surviving object_key would mean the fence leaked).
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE id = v_e1
                  AND (status <> 'FAILED' OR object_key IS NOT NULL)) THEN
        RAISE EXCEPTION 'A: the fenced seal must roll the pointer back';
    END IF;
    -- 07 (defect C): the plain FAILED terminal does NOT touch intent rows
    -- — the durable record of a mid-flight upload survives the terminal
    -- (the claim's barrier serialized the two writes, so no pass-through
    -- window exists) and the unified reclaim protocol owns it from here:
    -- lease long dead → claim → tombstone re-sweep deletes the late put →
    -- retire past the lifecycle window.
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent
                    WHERE owner_user_id = 1 AND export_id = v_e1
                      AND state = 'CLAIMED') THEN
        RAISE EXCEPTION 'A: the FAILED terminal must keep the tombstone for the unified reclaim';
    END IF;
    IF NOT vc.export_object_has_record(
            'exports/1/' || v_e1 || '-aaaaaaaaaaaaaaaa.json') THEN
        RAISE EXCEPTION 'A: a late put after the FAILED terminal must stay discoverable';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Timeline B: the sweeper's snapshot is stale — the worker seals READY
-- first; the claim then reads the live row, loses (row consumed), and the
-- object is not the sweeper's to delete.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e2 bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-165-b') INTO v_e2;
    PERFORM set_config('vc.e2', v_e2::text, false);
    PERFORM vc.record_export_upload_intent(1, v_e2,
        'exports/1/' || v_e2 || '-bbbbbbbbbbbbbbbb.json');
END;
$$;
COMMIT;
-- The intent id for the later claim probe (SD-only table: the harness reads
-- it as superuser, mirroring the runtime's worklist round-trip).
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-bbbbbbbbbbbbbbbb.json';
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'B: the recorded intent row must exist';
    END IF;
    PERFORM set_config('vc.b_intent_id', v_id::text, false);
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n3b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n3b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e2 bigint := current_setting('vc.e2')::bigint;
BEGIN
    -- The worker's READY seal consumes the OPEN row in the same transaction.
    IF vc.complete_export(1, v_e2, NULL, now() + interval '1 hour',
            'exports/1/' || v_e2 || '-bbbbbbbbbbbbbbbb.json', 321) <> 1 THEN
        RAISE EXCEPTION 'B: the READY seal must succeed';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e2 bigint := current_setting('vc.e2')::bigint;
BEGIN
    -- 06: age the lease past every grace FIRST, so the claim's live-lease
    -- re-validation cannot be the reason it loses — only the consumed row is.
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() - interval '20 minutes'
     WHERE id = current_setting('vc.b_intent_id')::bigint;
    -- The sweeper arrives with its pre-seal snapshot: the claim re-reads the
    -- live row, sees it consumed, and MUST skip (no key returned).
    IF vc.claim_export_upload_intent(1, current_setting('vc.b_intent_id')::bigint) IS NOT NULL THEN
        RAISE EXCEPTION 'B: the claim must lose after the READY seal';
    END IF;
    -- The sealed object is protected: a record still exists (the pointer).
    IF NOT vc.export_object_has_record('exports/1/' || v_e2 || '-bbbbbbbbbbbbbbbb.json') THEN
        RAISE EXCEPTION 'B: the sealed object must keep its record';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Timeline C: the same race against the FAILED-with-pointer fallback — the
-- fallback consumes the intent and the late claim loses.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e3 bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-165-c') INTO v_e3;
    PERFORM set_config('vc.e3', v_e3::text, false);
    PERFORM vc.record_export_upload_intent(1, v_e3,
        'exports/1/' || v_e3 || '-cccccccccccccccc.json');
END;
$$;
COMMIT;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-cccccccccccccccc.json';
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'C: the recorded intent row must exist';
    END IF;
    PERFORM set_config('vc.c_intent_id', v_id::text, false);
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n4b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n4b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e3 bigint := current_setting('vc.e3')::bigint;
BEGIN
    IF vc.fail_export_with_object(1, v_e3,
            'exports/1/' || v_e3 || '-cccccccccccccccc.json', 99, 'export-failed') <> 1 THEN
        RAISE EXCEPTION 'C: the pointer fallback must succeed';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e3 bigint := current_setting('vc.e3')::bigint;
BEGIN
    -- 06: age the lease first (same reason as timeline B).
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() - interval '20 minutes'
     WHERE id = current_setting('vc.c_intent_id')::bigint;
    IF vc.claim_export_upload_intent(1, current_setting('vc.c_intent_id')::bigint) IS NOT NULL THEN
        RAISE EXCEPTION 'C: the claim must lose after the pointer fallback';
    END IF;
    IF NOT vc.export_object_has_record('exports/1/' || v_e3 || '-cccccccccccccccc.json') THEN
        RAISE EXCEPTION 'C: the fallback-pointed object must keep its record';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Timeline E: two REAL connections race for one attempt. Connection A claims
-- and HOLDS the row lock (uncommitted); connection B's claim blocks and times
-- out (lock_timeout) — a real lock contention, not a sleep; after A commits,
-- B's retry reads the CLAIMED state and loses. Exactly one winner.
-- ---------------------------------------------------------------------------
-- A fresh export + expired intent for the race.
BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-165-e') INTO v_id;
    PERFORM set_config('vc.e4', v_id::text, false);
    PERFORM vc.record_export_upload_intent(1, v_id,
        'exports/1/' || v_id || '-dddddddddddddddd.json');
END;
$$;
COMMIT;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-dddddddddddddddd.json';
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'E: the recorded intent row must exist';
    END IF;
    PERFORM set_config('vc.e_intent_id', v_id::text, false);
END;
$$;
UPDATE vc.export_upload_intent
   SET lease_expires_at = now() - interval '20 minutes'
 WHERE id = current_setting('vc.e_intent_id')::bigint;

-- Scheduler A (dblink connection, established as superuser BEFORE any role
-- games): BEGIN + winning claim, left UNCOMMITTED.
SELECT dblink_connect('schedA', 'dbname=vc user=postgres password=vc');
SELECT dblink_connect('schedB', 'dbname=vc user=postgres password=vc');
SELECT dblink_exec('schedA', 'BEGIN');
SELECT dblink_exec('schedA', format(
    'DO $a$ BEGIN PERFORM vc.claim_export_upload_intent(1, %s); END $a$;',
    current_setting('vc.e_intent_id')));
-- Scheduler B (this session, a second independent connection perspective):
-- while A holds the uncommitted row lock, B's claim waits — proven with a
-- short lock_timeout on the REAL statement, then B backs off.
BEGIN;
SET LOCAL lock_timeout = '400ms';
DO $$
BEGIN
    BEGIN
        PERFORM vc.claim_export_upload_intent(1, current_setting('vc.e_intent_id')::bigint);
        RAISE EXCEPTION 'E: the racing claim must wait for the open claim';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must wait%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'E: unexpected racing claim error %', SQLERRM;
        END IF;
    END;
END;
$$;
ROLLBACK;
-- A commits its claim; B's retry now reads the CLAIMED row and loses.
SELECT dblink_exec('schedA', 'COMMIT');
DO $$
DECLARE
    v_key text;
BEGIN
    v_key := vc.claim_export_upload_intent(1, current_setting('vc.e_intent_id')::bigint);
    IF v_key IS NOT NULL THEN
        RAISE EXCEPTION 'E: after the winner committed, the loser must skip';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent
                    WHERE id = current_setting('vc.e_intent_id')::bigint
                      AND state = 'CLAIMED') THEN
        RAISE EXCEPTION 'E: exactly one winner must hold the CLAIMED row';
    END IF;
END;
$$;
SELECT dblink_disconnect('schedA');
SELECT dblink_disconnect('schedB');

-- ---------------------------------------------------------------------------
-- Timeline F: an actively-leased upload is never reclaimable, and renew
-- re-arms the lease (age alone is not the criterion). The worker protocol
-- calls run as vc_api; the harness drives the lease clock as superuser (the
-- intent table is SD-only for vc_api).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e4 bigint;
    v_intent bigint;
BEGIN
    -- Timeline E left its export PENDING (only the intent was claimed) —
    -- terminalize it so the one-in-flight slot frees up.
    PERFORM vc.fail_export(1, current_setting('vc.e4')::bigint, 'export-failed');
    SELECT vc.create_export_request(1, 'tok-165-f') INTO v_e4;
    SELECT vc.record_export_upload_intent(1, v_e4,
        'exports/1/' || v_e4 || '-eeeeeeeeeeeeeeee.json', 0) INTO v_intent;
    PERFORM set_config('vc.f_intent_id', v_intent::text, false);
    PERFORM set_config('vc.f_export_id', v_e4::text, false);
END;
$$;
COMMIT;

-- Age the row FAR past every grace window, but hold a live lease.
UPDATE vc.export_upload_intent
   SET created_at = now() - interval '2 hours',
       lease_expires_at = now() + interval '1 hour'
 WHERE id = current_setting('vc.f_intent_id')::bigint;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0)
     WHERE out_id = current_setting('vc.f_intent_id')::bigint;
    IF n <> 0 THEN
        RAISE EXCEPTION 'F: a live lease must protect an aged intent';
    END IF;
END;
$$;

-- Lease expiring re-opens reclamation.
UPDATE vc.export_upload_intent
   SET lease_expires_at = now() - interval '1 second'
 WHERE id = current_setting('vc.f_intent_id')::bigint;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0)
     WHERE out_id = current_setting('vc.f_intent_id')::bigint;
    IF n <> 1 THEN
        RAISE EXCEPTION 'F: an expired lease must list the intent, got %', n;
    END IF;
END;
$$;

-- renew re-arms the lease (owner-bound SD call).
BEGIN;
SELECT vc.set_owner_context(1, 'n6b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n6b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e4 bigint := current_setting('vc.f_export_id')::bigint;
BEGIN
    IF vc.renew_export_upload_lease(1, v_e4,
           'exports/1/' || v_e4 || '-eeeeeeeeeeeeeeee.json', 3600) <> 1 THEN
        RAISE EXCEPTION 'F: renew must re-arm the lease';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0)
     WHERE out_id = current_setting('vc.f_intent_id')::bigint;
    IF n <> 0 THEN
        RAISE EXCEPTION 'F: a renewed lease must protect the intent again';
    END IF;
END;
$$;

-- A non-PENDING export refuses NEW records (a terminal export can never
-- arm a fresh upload): seal this one first, then record must refuse.
BEGIN;
SELECT vc.set_owner_context(1, 'n6c', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n6c', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e4 bigint := current_setting('vc.f_export_id')::bigint;
BEGIN
    IF vc.complete_export(1, v_e4, NULL, now() + interval '1 hour',
           'exports/1/' || v_e4 || '-eeeeeeeeeeeeeeee.json', 1) <> 1 THEN
        RAISE EXCEPTION 'F: the seal must succeed';
    END IF;
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e4,
            'exports/1/' || v_e4 || '-ffffffffffffffff.json');
        RAISE EXCEPTION 'F: record on a sealed export unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not PENDING%' THEN
            RAISE EXCEPTION 'F: terminal-export record error %', SQLERRM;
        END IF;
    END;
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- Timeline D (owner 3, self-contained): deletion cleanup deletes a
-- not-yet-existing object and cascades the rows; a LATE worker put then has
-- no record at all — export_object_has_record is false (exactly what the
-- scheduler's prefix audit deletes), and every worker-side write path stays
-- refused by the deletion barrier.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(3, 'n7', encode(vc.hmac(convert_to('vc-owner-binding-v1|3|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n7', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint;
BEGIN
    SELECT vc.create_export_request(3, 'tok-165-d') INTO v_export;
    PERFORM set_config('vc.d_export_id', v_export::text, false);
    PERFORM vc.record_export_upload_intent(3, v_export,
        'exports/3/' || v_export || '-0123456789abcdef.json');
END;
$$;
COMMIT;
-- The deletion intent commits (the coordinator path); the pre-cascade
-- cleanup lists the intent key and deletes the (absent) object; the cascade
-- then destroys the owner's rows — the object key below is what a late
-- worker would target.
BEGIN;
SELECT vc.set_owner_context(3, 'n8', encode(vc.hmac(convert_to('vc-owner-binding-v1|3|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n8', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint := current_setting('vc.d_export_id')::bigint;
    v_key text := 'exports/3/' || current_setting('vc.d_export_id') || '-0123456789abcdef.json';
    n int;
BEGIN
    PERFORM vc.request_account_deletion_current();
    -- Pre-cascade worklist sees the intent key; the object delete (absent)
    -- is a no-op; clear_export_object removes pointer and intent rows.
    SELECT count(*) INTO n FROM vc.list_owner_export_objects(3);
    IF n <> 1 THEN
        RAISE EXCEPTION 'D: the cleanup worklist must see the intent key, got %', n;
    END IF;
    PERFORM vc.clear_export_object(3, v_export, v_key);
    SELECT count(*) INTO n FROM vc.list_owner_export_objects(3);
    IF n <> 0 THEN
        RAISE EXCEPTION 'D: the cleanup must converge, got %', n;
    END IF;
END;
$$;
COMMIT;
-- The account cascade removes owner 3 entirely.
DELETE FROM vc.identity_account WHERE id = 3;
DELETE FROM vc.vc_user WHERE id = 3;
DO $$
DECLARE
    v_key text := 'exports/3/' || current_setting('vc.d_export_id') || '-0123456789abcdef.json';
BEGIN
    -- The late worker's object now has NO database record: exactly the
    -- condition the scheduler's prefix audit deletes (and nothing else can
    -- ever reference it — the owner is gone).
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'D: after the cascade the late object must be record-less';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE owner_user_id = 3) THEN
        RAISE EXCEPTION 'D: the cascade must have removed every intent row';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Owner 2 is untouched throughout.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'owner 2 must never appear';
    END IF;
END;
$$;

-- Cleanup (shared sequential database): reset the session GUCs; owner 1's
-- leftover exports are terminal (READY/FAILED) and their intent rows are
-- consumed or retained tombstones — later tests TRUNCATE anyway.
RESET vc.e1;
RESET vc.e2;
RESET vc.e3;
RESET vc.e4;
RESET vc.b_intent_id;
RESET vc.c_intent_id;
RESET vc.e_intent_id;
RESET vc.f_intent_id;
RESET vc.f_export_id;
RESET vc.d_export_id;
