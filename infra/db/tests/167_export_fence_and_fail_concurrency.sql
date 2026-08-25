-- 167_export_fence_and_fail_concurrency:
-- DOGFOOD-STABILIZATION-07 defects C and D against REAL two-connection
-- PostgreSQL concurrency (psql session + dblink, lock_timeout probes — no
-- sleeps pretending to be protocols).
--
-- Defect C (fail_export concurrency):
--   C1. a record transaction HOLDING the owner barrier makes the plain
--       fail_export WAIT (lock_timeout proof) — no record(PENDING) ↔
--       fail(FAILED) pass-through window;
--   C2. fail commits first → every later record refuses (PENDING check);
--   C3. record commits first, upload mid-flight → fail terminalizes but
--       the DURABLE intent row survives (07: plain fail never deletes it);
--   C4. a CLAIMED tombstone is never deleted by the plain fail — only the
--       retirement path removes it.
--
-- Defect D (prefix-audit TOCTOU, closed by the durable object fence):
--   D1. audit judges a candidate (no record) → holds the RECLAIM fence →
--       the worker's record RAISES before any put/seal — audit wins, no
--       READY pointer can appear;
--   D2. worker records first (WRITER fence committed) → the audit's fence
--       loses → no delete → the worker seals READY with the object intact;
--   D3. a fence INSERT racing an uncommitted one waits on the row lock
--       (lock_timeout proof) and then loses to the committed holder;
--   D4. the seal consumes the intent and RELEASES the WRITER fence — the
--       audit may fence the key afterwards (pointer keeps it safe);
--   D5. claim transfers a WRITER fence to RECLAIM; retirement releases it —
--       and the retirement window follows the upload lifecycle derivation
--       (floor 300s: a 2-minute-old claim does NOT retire, a 20-minute one
--       with terminal export + no pointer does).
--
-- PG 18 dblink/psql rules (same as 163/165/166): dblink connections before
-- any role games; a fresh remote BEGIN + SET LOCAL lock_timeout wraps every
-- probe; SD-only tables are only read/aged as superuser.

\set ON_ERROR_STOP on

-- Owner binding for the remote worker connection (dblink_exec runs it on
-- the remote backend, so pg_backend_pid()/xact id resolve there — 163
-- pattern).
\set worker_bind 'DO $rb$ BEGIN PERFORM vc.set_owner_context(1, ''w1'', encode(vc.hmac(convert_to(''vc-owner-binding-v1|1|'' || pg_backend_pid() || ''|'' || pg_current_xact_id() || ''|w1'', ''UTF8''), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), ''UTF8''), ''sha256''), ''hex'')); END $rb$;'

CREATE EXTENSION IF NOT EXISTS dblink;

TRUNCATE vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.export_upload_intent, vc.export_object_fence,
         vc.consent_record,
         vc.entitlement_snapshot, vc.service_class_assignment, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.work_item,
         vc.outbox_event, vc.realtime_event, vc.account_deletion_intent,
         vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);

-- One PENDING export for the C scenarios (id via session GUC).
BEGIN;
SELECT vc.set_owner_context(1, 'n0', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n0', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-167-c') INTO v_id;
    PERFORM set_config('vc.c_export_id', v_id::text, false);
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- C1: the worker's record transaction holds the owner barrier (in-flight,
-- uncommitted). The plain fail_export — which since 07 takes the SAME
-- barrier — must WAIT on it: a real lock_timeout probe, not a sleep.
-- ---------------------------------------------------------------------------
SELECT dblink_connect('worker', 'dbname=vc user=postgres password=vc');
SELECT dblink_exec('worker', 'BEGIN');
SELECT dblink_exec('worker', :'worker_bind');
SELECT dblink_exec('worker', format(
    'DO $w$ BEGIN PERFORM vc.record_export_upload_intent(1, %s, '
    || '''exports/1/'' || %s || ''-0123456789abcdef.json'', 90); END $w$;',
    current_setting('vc.c_export_id'), current_setting('vc.c_export_id')));
BEGIN;
SET LOCAL lock_timeout = '400ms';
SELECT vc.set_owner_context(1, 'c1probe', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'c1probe', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
BEGIN
    BEGIN
        PERFORM vc.fail_export(1, current_setting('vc.c_export_id')::bigint, 'export-failed');
        RAISE EXCEPTION 'C1: fail_export must wait for the in-flight record';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must wait%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'C1: unexpected fail_export error %', SQLERRM;
        END IF;
    END;
END;
$$;
ROLLBACK;

-- The record commits; the retried fail terminalizes. C3: the durable
-- intent row SURVIVES the plain fail (07 defect C — the unified reclaim
-- protocol owns it from here, so a mid-flight upload never loses its
-- record to a concurrent terminal).
SELECT dblink_exec('worker', 'COMMIT');
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF vc.fail_export(1, current_setting('vc.c_export_id')::bigint, 'export-failed') <> 1 THEN
        RAISE EXCEPTION 'C1: the retried fail must terminalize after the record commits';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.c_export_id')::bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent
                    WHERE owner_user_id = 1 AND export_id = v_e
                      AND state = 'OPEN') THEN
        RAISE EXCEPTION 'C3: the FAILED terminal must keep the durable intent row';
    END IF;
    IF NOT vc.export_object_has_record(
            'exports/1/' || v_e || '-0123456789abcdef.json') THEN
        RAISE EXCEPTION 'C3: the mid-flight upload must stay discoverable';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- C2 (fresh export): fail commits first → a later record refuses on the
-- PENDING check (the barrier serialized the order, the status closes it).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-167-c2') INTO v_e;
    PERFORM set_config('vc.c2_export_id', v_e::text, false);
    PERFORM vc.fail_export(1, v_e, 'export-failed');
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e,
            'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 90);
        RAISE EXCEPTION 'C2: record after a committed fail unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not PENDING%' THEN
            RAISE EXCEPTION 'C2: unexpected record error %', SQLERRM;
        END IF;
    END;
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- C4 (fresh export): a CLAIMED tombstone is immune to the plain fail —
-- only the retirement path (D5 below) removes it.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
    v_id bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-167-c4') INTO v_e;
    PERFORM set_config('vc.c4_export_id', v_e::text, false);
    PERFORM vc.record_export_upload_intent(1, v_e,
        'exports/1/' || v_e || '-bbbbbbbbbbbbbbbb.json', 0);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.c4_export_id')::bigint;
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-bbbbbbbbbbbbbbbb.json';
    PERFORM set_config('vc.c4_intent_id', v_id::text, false);
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() - interval '20 minutes'
     WHERE id = v_id;
    IF vc.claim_export_upload_intent(1, v_id, 0) IS NULL THEN
        RAISE EXCEPTION 'C4: the expired intent must be claimable';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.fail_export(1, current_setting('vc.c4_export_id')::bigint, 'export-failed');
END;
$$;
COMMIT;
DO $$
DECLARE
    v_id bigint := current_setting('vc.c4_intent_id')::bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent
                    WHERE id = v_id AND state = 'CLAIMED') THEN
        RAISE EXCEPTION 'C4: the plain fail must not delete the CLAIMED tombstone';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- D1: the audit's view of an unrecorded object. A FRESH PENDING export's
-- legal key is fenced FIRST (it has no record — the export has not
-- recorded yet); the worker's record then RAISES before any put/seal.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_e bigint := current_setting('vc.c_export_id')::bigint;
    v_key text := 'exports/1/' || v_e || '-0123456789abcdef.json';
    v_id bigint;
    v_held boolean;
BEGIN
    -- The C1 intent row is OPEN with a dead lease: age it into a CLAIMED
    -- tombstone (one UPDATE satisfies the claim-shape CHECK), past the
    -- retirement lifecycle window, then retire it — the fence is released
    -- and the key becomes genuinely unrecorded for the D scenarios.
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND export_id = v_e;
    UPDATE vc.export_upload_intent
       SET state = 'CLAIMED',
           claimed_at = now() - interval '30 minutes',
           lease_expires_at = now() - interval '30 minutes'
     WHERE id = v_id;
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 1 THEN
        RAISE EXCEPTION 'D0: the aged tombstone of the FAILED export must retire';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_object_fence WHERE object_key = v_key) THEN
        RAISE EXCEPTION 'D0: retirement must release the fence';
    END IF;
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'D0: the retired key must be unrecorded';
    END IF;
END;
$$;

-- A fresh PENDING export whose legal key the audit fences before the
-- worker records it (the judgment order of the TOCTOU: audit first).
BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-167-d1') INTO v_e;
    PERFORM set_config('vc.d1_export_id', v_e::text, false);
    PERFORM set_config('vc.d1_key',
        'exports/1/' || v_e || '-0123456789abcdef.json', false);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_key text := current_setting('vc.d1_key');
BEGIN
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'D1: the pre-record key must be unrecorded';
    END IF;
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'D1: the audit must hold the fence of an unrecorded key';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n5b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.d1_export_id')::bigint;
BEGIN
    -- The worker arrives AFTER the audit's judgment: the record RAISES on
    -- the held reclaim fence — before any put, so no seal of that key can
    -- ever start (a seal requires exactly one OPEN intent, which the
    -- refused record never created).
    BEGIN
        PERFORM vc.record_export_upload_intent(1, v_e,
            current_setting('vc.d1_key'), 90);
        RAISE EXCEPTION 'D1: record against the audit''s reclaim fence unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%fenced for reclaim%' THEN
            RAISE EXCEPTION 'D1: unexpected fenced-record error %', SQLERRM;
        END IF;
    END;
    PERFORM vc.fail_export(1, v_e, 'export-failed');
END;
$$;
COMMIT;
DO $$
BEGIN
    -- The audit releases its fence after the (storage-side) delete.
    IF vc.clear_export_orphan_reclaim(current_setting('vc.d1_key')) <> 1 THEN
        RAISE EXCEPTION 'D1: the audit must be able to release its fence';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- D2: the worker wins. The record commits first (WRITER fence + intent
-- row) → the audit's fence LOSES → nothing is deleted → the worker seals
-- READY: the object and the pointer both survive — never a READY pointer
-- over a deleted object.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-167-d2') INTO v_e;
    PERFORM set_config('vc.d2_export_id', v_e::text, false);
    PERFORM vc.record_export_upload_intent(1, v_e,
        'exports/1/' || v_e || '-cccccccccccccccc.json', 90);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.d2_export_id')::bigint;
BEGIN
    -- The audit's fence loses against the committed WRITER.
    IF vc.fence_export_orphan_reclaim('exports/1/' || v_e || '-cccccccccccccccc.json') THEN
        RAISE EXCEPTION 'D2: the audit''s fence must lose against a live writer';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n7', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n7', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.d2_export_id')::bigint;
BEGIN
    IF vc.complete_export(1, v_e, NULL, now() + interval '1 hour',
           'exports/1/' || v_e || '-cccccccccccccccc.json', 33) <> 1 THEN
        RAISE EXCEPTION 'D2: the worker''s seal must succeed after winning the fence';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.d2_export_id')::bigint;
    v_key text := 'exports/1/' || v_e || '-cccccccccccccccc.json';
BEGIN
    -- D4: the seal consumed the intent AND released the WRITER fence — and
    -- (08 defect B) the fence's in-transaction re-verification sees the
    -- READY pointer: the audit's fence call must REFUSE (false) and leave
    -- no placeholder behind. The pointer keeps the object safe from the
    -- audit; the fence itself stays callable (no exception).
    IF EXISTS (SELECT 1 FROM vc.export_object_fence WHERE object_key = v_key) THEN
        RAISE EXCEPTION 'D4: the READY seal must release the writer fence';
    END IF;
    IF NOT vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'D2: the sealed object must keep its record';
    END IF;
    IF vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'D4: a READY pointer must refuse the reclaim fence';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_object_fence
                WHERE object_key = v_key AND holder = 'RECLAIM') THEN
        RAISE EXCEPTION 'D4: the refused fence must not leave a placeholder';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- D3: two fence INSERTs racing — the uncommitted holder blocks the second
-- INSERT on the row lock (a REAL wait, proven by lock_timeout), and the
-- loser sees the committed holder afterwards.
-- ---------------------------------------------------------------------------
SELECT dblink_connect('fenceA', 'dbname=vc user=postgres password=vc');
SELECT dblink_exec('fenceA', 'BEGIN');
SELECT dblink_exec('fenceA', format(
    'DO $f$ BEGIN PERFORM vc.fence_export_orphan_reclaim(%L); END $f$;',
    'exports/1/9999999999-dddddddddddddddd.json'));
BEGIN;
SET LOCAL lock_timeout = '400ms';
DO $$
BEGIN
    BEGIN
        PERFORM vc.fence_export_orphan_reclaim(
            'exports/1/9999999999-dddddddddddddddd.json');
        RAISE EXCEPTION 'D3: the racing fence must wait for the open holder';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must wait%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'D3: unexpected racing fence error %', SQLERRM;
        END IF;
    END;
END;
$$;
ROLLBACK;
SELECT dblink_exec('fenceA', 'COMMIT');
DO $$
BEGIN
    -- After the holder committed, the retry loses (same holder re-arms, a
    -- WRITER would lose — here the loser perspective is the same row).
    IF NOT vc.fence_export_orphan_reclaim(
            'exports/1/9999999999-dddddddddddddddd.json') THEN
        RAISE EXCEPTION 'D3: the reclaim re-arm of the same holder must succeed';
    END IF;
    PERFORM vc.clear_export_orphan_reclaim(
        'exports/1/9999999999-dddddddddddddddd.json');
END;
$$;
SELECT dblink_disconnect('fenceA');
SELECT dblink_disconnect('worker');

-- ---------------------------------------------------------------------------
-- D5 (fresh export): the retirement window follows the upload lifecycle —
-- a 2-minute-old claim does NOT retire (floor 300s), a 20-minute one with
-- a terminal export and no pointer does, and the retirement releases the
-- fence so the audit can converge a pathological late writer.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n8', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n8', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-167-d5') INTO v_e;
    PERFORM set_config('vc.d5_export_id', v_e::text, false);
    PERFORM vc.record_export_upload_intent(1, v_e,
        'exports/1/' || v_e || '-eeeeeeeeeeeeeeee.json', 0);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.d5_export_id')::bigint;
    v_id bigint;
    v_key text := NULL;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-eeeeeeeeeeeeeeee.json';
    PERFORM set_config('vc.d5_intent_id', v_id::text, false);
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() - interval '20 minutes'
     WHERE id = v_id;
    IF vc.claim_export_upload_intent(1, v_id, 0) IS NULL THEN
        RAISE EXCEPTION 'D5: the expired intent must be claimable';
    END IF;
    -- The claim transferred the fence to RECLAIM (the sweeper owns the
    -- key's delete right now).
    IF EXISTS (SELECT 1 FROM vc.export_object_fence f
                JOIN vc.export_upload_intent i ON i.object_key = f.object_key
                WHERE i.id = v_id AND f.holder <> 'RECLAIM') THEN
        RAISE EXCEPTION 'D5: the claim must transfer the fence to RECLAIM';
    END IF;
    -- Age the claim only 2 minutes: the lifecycle floor (300s) keeps the
    -- tombstone — a late in-flight call may still be ending.
    UPDATE vc.export_upload_intent
       SET claimed_at = now() - interval '2 minutes'
     WHERE id = v_id;
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 0 THEN
        RAISE EXCEPTION 'D5: a 2-minute-old claim must not retire (lifecycle floor)';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n9', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n9', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.fail_export(1, current_setting('vc.d5_export_id')::bigint, 'export-failed');
END;
$$;
COMMIT;
DO $$
DECLARE
    v_id bigint := current_setting('vc.d5_intent_id')::bigint;
    v_key text;
BEGIN
    SELECT object_key INTO v_key FROM vc.export_upload_intent WHERE id = v_id;
    -- Past the lifecycle window (terminal export, no pointer): the row
    -- retires and the fence is released — the audit converges any object
    -- a pathological writer still lands afterwards.
    UPDATE vc.export_upload_intent
       SET claimed_at = now() - interval '20 minutes'
     WHERE id = v_id;
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 1 THEN
        RAISE EXCEPTION 'D5: past the window the tombstone must retire';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE id = v_id) THEN
        RAISE EXCEPTION 'D5: the retired row must be deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_object_fence WHERE object_key = v_key) THEN
        RAISE EXCEPTION 'D5: retirement must release the fence';
    END IF;
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'D5: the audit must be able to fence the retired key';
    END IF;
    PERFORM vc.clear_export_orphan_reclaim(v_key);
END;
$$;

RESET vc.c_export_id;
RESET vc.c2_export_id;
RESET vc.c4_export_id;
RESET vc.c4_intent_id;
RESET vc.d1_key;
RESET vc.d1_export_id;
RESET vc.d2_export_id;
RESET vc.d5_export_id;
RESET vc.d5_intent_id;
