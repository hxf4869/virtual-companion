-- 163_deletion_export_barrier_race: DOGFOOD-STABILIZATION-04 audit defect D —
-- a REAL lock-contention timeline over TWO REAL PostgreSQL connections
-- (the worker on the psql session, the deletion coordinator on dblink
-- connections), replacing the 03-round sequential intent-first script:
--
--   1. the worker's owner transaction passes the deletion check, performs a
--      REAL complete_export (pointer written, NOT yet committed) and stays
--      open — holding the V113 owner-scoped pointer barrier;
--   2. the deletion request starts concurrently on the second connection:
--      it must WAIT for the in-flight pointer writer (asserted via a lock
--      timeout on the real vc.request_account_deletion_current);
--   3. the worker's seal transaction rolls back (barrier released) → the
--      deletion retries and its intent commits;
--   4. every LATER pointer write — complete_export AND the
--      fail_export_with_object INDEPENDENT compensation transaction — is
--      refused atomically, no DB pointer or upload intent survives, and a
--      fresh export request is refused;
--   5. the V112 id-array marker short-circuits under the deletion intent
--      (the rows are about to cascade away) without tripping V103's guard.
--
-- PG 18's dblink refuses NEW connections initiated by a non-superuser
-- (current_user after SET ROLE) even with a password in the connection
-- string, so all cross-connection sessions are established FIRST — still as
-- the migration owner — and REUSED after SET ROLE.

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
VALUES (1, 'alice-race', 'x', 'USER', 'ACTIVE', 'alice');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL);

-- The owner context for the deletion connection is established REMOTELY
-- (the binding proof is connection/transaction bound): a helper string the
-- coordinator session evaluates against ITS OWN backend pid / xact id.
\set deletion_bind 'DO $rb$ BEGIN PERFORM vc.set_owner_context(1, ''n9'', encode(vc.hmac(convert_to(''vc-owner-binding-v1|1|'' || pg_backend_pid() || ''|'' || pg_current_xact_id() || ''|n9'', ''UTF8''), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), ''UTF8''), ''sha256''), ''hex'')); END $rb$;'

-- Phase 0: a PENDING export exists (the work item the worker claimed). The
-- id travels to the later DO blocks through a session GUC — psql does NOT
-- interpolate :variables inside dollar-quoted bodies.
BEGIN;
SELECT vc.set_owner_context(1, 'n0', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n0', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-race-1') INTO v_id;
    IF v_id IS NULL OR v_id <= 0 THEN
        RAISE EXCEPTION 'phase 0: create_export_request returned no id';
    END IF;
    PERFORM set_config('vc.race_export_id', v_id::text, false);
    -- 06: object-mode seals require exactly one matching OPEN upload intent —
    -- record it here (committed) so the phase-1 in-flight seal can consume it.
    PERFORM vc.record_export_upload_intent(
        1, v_id, 'exports/1/' || v_id || '-0123456789abcdef.json');
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- Phase 1 (WORKER, this connection): the open owner transaction verifies the
-- intent is inactive, then performs a REAL pointer write (complete_export —
-- pointer row updated, transaction NOT committed) and KEEPS the transaction
-- open: the exact "passed the deletion check, pointer not yet committed"
-- window, holding the V113 owner-scoped barrier lock.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT dblink_connect('coord', 'dbname=vc user=postgres password=vc');
SELECT dblink_connect('probe', 'dbname=vc user=postgres password=vc');
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_rows int;
BEGIN
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'phase 1: intent must not be active yet';
    END IF;
    -- The REAL seal statement: takes the barrier lock, passes the intent
    -- check, writes the pointer. The transaction stays open on purpose.
    -- (plpgsql assignment, not SELECT ... INTO: a multi-line bare function
    -- call with a trailing INTO parses as an undirected query.)
    v_rows := vc.complete_export(
        1, current_setting('vc.race_export_id')::bigint, NULL,
        now() + interval '1 hour',
        'exports/1/' || current_setting('vc.race_export_id') || '-0123456789abcdef.json', 123);
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'phase 1: in-flight complete_export moved % rows', v_rows;
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Phase 2 (DELETION, second REAL connection): while the worker holds the
-- barrier, the deletion request must WAIT — asserted by a real lock timeout
-- on vc.request_account_deletion_current (the 04-round shared barrier).
-- psql does NOT interpolate :variables inside dollar-quoted bodies, so the
-- remote BEGIN / lock_timeout / owner binding run as plain statements.
-- ---------------------------------------------------------------------------
SELECT dblink_exec('coord', 'BEGIN');
SELECT dblink_exec('coord', 'SET LOCAL lock_timeout = ''600ms''');
SELECT dblink_exec('coord', :'deletion_bind');
DO $$
BEGIN
    BEGIN
        PERFORM dblink_exec('coord', 'DO $rd$ BEGIN PERFORM vc.request_account_deletion_current(); END $rd$;');
        RAISE EXCEPTION 'phase 2: deletion did not wait for the in-flight pointer writer';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%did not wait%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'phase 2: unexpected deletion error: %', SQLERRM;
        END IF;
    END;
    -- The remote transaction aborted on the timeout; drop it cleanly.
    PERFORM dblink_exec('coord', 'ROLLBACK');
END;
$$;

-- ---------------------------------------------------------------------------
-- Phase 3 (WORKER rolls back): the in-flight seal dies (e.g. the post-outbound
-- work-item guard fails application-side) — the barrier lock releases with
-- the transaction end.
-- ---------------------------------------------------------------------------
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Phase 4 (DELETION retries, still a REAL call): with the pointer writer
-- gone, the deletion acquires the barrier, commits the intent, cancels
-- in-flight work — and the pre-cascade object worklist (now UNIONing the
-- V114 upload intents) sees nothing to clean.
-- ---------------------------------------------------------------------------
SELECT dblink_exec('coord', 'BEGIN');
SELECT dblink_exec('coord', :'deletion_bind');
DO $$
DECLARE
    n int;
BEGIN
    PERFORM dblink_exec('coord', 'DO $rd$ BEGIN PERFORM vc.request_account_deletion_current(); END $rd$;');
    SELECT t.ok INTO n FROM dblink('coord',
        'SELECT CASE WHEN EXISTS (SELECT 1 FROM vc.account_deletion_intent '
        || 'WHERE account_id = 1) THEN 1 ELSE 0 END AS ok')
        AS t(ok int);
    IF n <> 1 THEN
        RAISE EXCEPTION 'phase 4: the retried deletion must commit the intent';
    END IF;
    -- Pre-cascade cleanup worklist: the phase-0 upload intent (its seal was
    -- rolled back by phase 3, so the row survived) is exactly the
    -- crash-after-put shape the worklist UNION exists for.
    SELECT t.n INTO n FROM dblink('coord',
        'SELECT count(*) AS n FROM vc.list_owner_export_objects(1)')
        AS t(n int);
    IF n <> 1 THEN
        RAISE EXCEPTION 'phase 4: the surviving upload intent must be listed, got %', n;
    END IF;
    -- Coordinator-style cleanup (the bucket object is absent; clear removes
    -- the intent row): after it, no pointer rows and no upload intents.
    PERFORM dblink_exec('coord', format(
        'DO $rd$ BEGIN PERFORM vc.clear_export_object(1, %s, '
        || '''exports/1/'' || %s || ''-0123456789abcdef.json''); END $rd$;',
        current_setting('vc.race_export_id'), current_setting('vc.race_export_id')));
    SELECT t.n INTO n FROM dblink('coord',
        'SELECT count(*) AS n FROM vc.list_owner_export_objects(1)')
        AS t(n int);
    IF n <> 0 THEN
        RAISE EXCEPTION 'phase 4: cleanup expected no pointers/intents, got %', n;
    END IF;
    -- Re-check stability, then the account cascade removes the export rows.
    SELECT t.n INTO n FROM dblink('coord',
        'SELECT count(*) AS n FROM vc.list_owner_export_objects(1)')
        AS t(n int);
    IF n <> 0 THEN
        RAISE EXCEPTION 'phase 4: re-check expected no pointers/intents, got %', n;
    END IF;
    PERFORM dblink_exec('coord',
        'DELETE FROM vc.export_request WHERE owner_user_id = 1');
    PERFORM dblink_exec('coord', 'COMMIT');
END;
$$;

-- ---------------------------------------------------------------------------
-- Phase 5 (stale WORKER resumes / the independent compensation transaction):
-- with the intent committed, EVERY pointer write is refused atomically —
-- complete_export AND the fail_export_with_object fallback, each exercised
-- in its OWN fresh owner transaction (the compensation path the legacy runtime worker
-- runs after a rolled-back seal).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.complete_export(1, current_setting('vc.race_export_id')::bigint, NULL,
                               now() + interval '1 hour',
                               'exports/1/' || current_setting('vc.race_export_id') || '-deadbeef.json', 123);
    RAISE EXCEPTION 'phase 5: complete_export after deletion intent unexpectedly allowed';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unexpectedly allowed%' THEN
        RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%deletion%' THEN
        RAISE EXCEPTION 'phase 5: unexpected complete_export error: %', SQLERRM;
    END IF;
END;
$$;
ROLLBACK;

BEGIN;
SELECT vc.set_owner_context(1, 'n6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.fail_export_with_object(1, current_setting('vc.race_export_id')::bigint,
                                       'exports/1/' || current_setting('vc.race_export_id') || '-deadbeef.json',
                                       123, 'export-failed');
    RAISE EXCEPTION 'phase 5: fail_export_with_object after deletion intent unexpectedly allowed';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unexpectedly allowed%' THEN
        RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%deletion%' THEN
        RAISE EXCEPTION 'phase 5: unexpected fail_export_with_object error: %', SQLERRM;
    END IF;
END;
$$;
ROLLBACK;

-- The V112 id-array marker (defect C's rejection path) short-circuits under
-- the deletion intent: 0 rows flipped, no V103 guard exception — the rows
-- are about to cascade away and no new outbound can start for this owner.
BEGIN;
SELECT vc.set_owner_context(1, 'n7', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n7', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
BEGIN
    SELECT vc.mark_messages_model_ineligible(1, ARRAY[1]) INTO n;
    IF n <> 0 THEN
        RAISE EXCEPTION 'phase 5: the marker must short-circuit under a deletion intent';
    END IF;
END;
$$;
ROLLBACK;

-- ---------------------------------------------------------------------------
-- Phase 6: after the dust settles — no export row, no pointer, no upload
-- intent, and a NEW export request is refused by the same barrier.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n8', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n8', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
BEGIN
    -- vc_api has no direct table SELECT (V16); the pointer worklist SD is
    -- the runtime-reachable view: zero pointer/intent rows survive.
    SELECT count(*) INTO n FROM vc.list_owner_export_objects(1);
    IF n <> 0 THEN
        RAISE EXCEPTION 'phase 6: no pointer may survive, got %', n;
    END IF;
    BEGIN
        PERFORM vc.create_export_request(1, 'tok-race-2');
        RAISE EXCEPTION 'phase 6: create after deletion intent unexpectedly allowed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly allowed%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%deletion%' THEN
            RAISE EXCEPTION 'phase 6: unexpected create error: %', SQLERRM;
        END IF;
    END;
END;
$$;

-- Defect C, DB side: a probe failing on an INDEPENDENT connection (rolled
-- back there) must not poison this session's open transaction — an SD write
-- on THIS session's transaction (the safety-event row the INPUT_BLOCKED
-- walk persists, V58) must still succeed and commit. Had the probe failure
-- poisoned this transaction, the write would raise "current transaction is
-- aborted". (The probe connection was opened before SET ROLE, see Phase 1.)
DO $$
BEGIN
    PERFORM dblink_exec('probe', 'BEGIN');
    BEGIN
        PERFORM dblink_exec('probe', 'SELECT 1/0');
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected: the probe fails on its own connection only
    END;
    PERFORM dblink_exec('probe', 'ROLLBACK');
    PERFORM dblink_disconnect('probe');
    PERFORM dblink_disconnect('coord');
    -- The INPUT_BLOCKED terminal walk persists exactly this shape of write
    -- (SafetyEventService.record, V58 SD) — it must still succeed here.
    PERFORM vc.record_safety_event(1, NULL, 'INPUT', 'R3_HIGH', 'input-probe-commit');
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- Phase 7 (DOGFOOD-STABILIZATION-05, bigint advisory lock): owner ids at or
-- above 2^31 previously CRASHED the barrier (owner::int overflow). The
-- lossless (owner >> 32, low-32) split must lock them correctly, keep the
-- deletion-may-block semantics, and never serialize two different owners.
-- ---------------------------------------------------------------------------
INSERT INTO vc.vc_user(id, display_name)
VALUES (2147483648, 'big-owner-a'), (5000000000, 'big-owner-b');
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
VALUES (2147483648, 'big-owner-a', 'x', 'USER', 'ACTIVE', 'big-a');

-- The int64 extreme locks without overflow (superuser sanity probe).
DO $$
BEGIN
    PERFORM vc.export_pointer_barrier(9223372036854775807);
    PERFORM vc.export_pointer_barrier(2147483648);
END;
$$;

-- The full protocol chain for owner 2147483648 (2^31): PENDING export,
-- fenced intent record — the exact statements that used to raise
-- "integer out of range" under the 04-round owner::int key. The dblink
-- connection is established BEFORE the owner binding (PG 18 refuses
-- dblink_connect from a non-superuser role, see the file header).
SELECT dblink_connect('bigcoord', 'dbname=vc user=postgres password=vc');
BEGIN;
SELECT vc.set_owner_context(2147483648, 'n10', encode(vc.hmac(convert_to('vc-owner-binding-v1|2147483648|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n10', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint;
BEGIN
    SELECT vc.create_export_request(2147483648, 'tok-big-1') INTO v_export;
    PERFORM set_config('vc.big_export_id', v_export::text, false);
    PERFORM vc.record_export_upload_intent(
        2147483648, v_export,
        'exports/2147483648/' || v_export || '-1234567890abcdef.json');
END;
$$;

-- The worker's barrier is now HELD on the open transaction (the deletion
-- below must block on it — same shared-barrier semantics as Phase 2, now
-- with a >2^31 owner on BOTH sides).
SELECT dblink_exec('bigcoord', 'BEGIN');
SELECT dblink_exec('bigcoord', 'SET LOCAL lock_timeout = ''600ms''');
SELECT dblink_exec('bigcoord', 'DO $rb$ BEGIN PERFORM vc.set_owner_context(2147483648, ''n11'', encode(vc.hmac(convert_to(''vc-owner-binding-v1|2147483648|'' || pg_backend_pid() || ''|'' || pg_current_xact_id() || ''|n11'', ''UTF8''), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), ''UTF8''), ''sha256''), ''hex'')); END $rb$;');
DO $$
BEGIN
    BEGIN
        PERFORM dblink_exec('bigcoord', 'DO $rd$ BEGIN PERFORM vc.request_account_deletion_current(); END $rd$;');
        RAISE EXCEPTION 'phase 7: deletion for the big owner did not wait for its barrier';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%did not wait%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'phase 7: unexpected big-owner deletion error: %', SQLERRM;
        END IF;
    END;
    PERFORM dblink_exec('bigcoord', 'ROLLBACK');
END;
$$;
ROLLBACK;

-- Owner isolation (two REAL connections): this session HOLDS owner
-- 2147483648's barrier on an open transaction; a second connection with a
-- 600ms lock timeout acquires DIFFERENT owner 5000000000's barrier
-- instantly — the lossless key never serializes two owners against each
-- other (a shared lock word would time out here), while the SAME owner's
-- barrier on that connection still has to wait. The remote transaction and
-- its SET LOCAL lock_timeout are established FRESH here: the earlier
-- deletion-wait transaction rolled back, and SET LOCAL outside a
-- transaction block is a no-op that would leave the probe waiting forever.
BEGIN;
SET LOCAL lock_timeout = '600ms';
DO $$
BEGIN
    PERFORM vc.export_pointer_barrier(2147483648);
END;
$$;
SELECT dblink_exec('bigcoord', 'BEGIN');
SELECT dblink_exec('bigcoord', 'SET LOCAL lock_timeout = ''600ms''');
SELECT dblink_exec('bigcoord',
    'DO $ob$ BEGIN PERFORM vc.export_pointer_barrier(5000000000); END $ob$;');
DO $$
BEGIN
    BEGIN
        PERFORM dblink_exec('bigcoord',
            'DO $sb$ BEGIN PERFORM vc.export_pointer_barrier(2147483648); END $sb$;');
        RAISE EXCEPTION 'phase 7: the same owner''s barrier must stay exclusive';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must stay exclusive%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'phase 7: unexpected same-owner probe error: %', SQLERRM;
        END IF;
    END;
    PERFORM dblink_exec('bigcoord', 'ROLLBACK');
    PERFORM dblink_disconnect('bigcoord');
END;
$$;
ROLLBACK;

-- Cleanup: this file runs in the SHARED sequential database — remove the
-- deletion intent (and its V103 outbound guards) so the numbered tests that
-- follow see a clean owner 1, and drop the session GUCs used above.
DELETE FROM vc.account_deletion_intent WHERE account_id = 1;
DELETE FROM vc.vc_user WHERE id IN (2147483648, 5000000000);
DELETE FROM vc.identity_account WHERE id = 2147483648;
RESET vc.race_export_id;
RESET vc.big_export_id;
