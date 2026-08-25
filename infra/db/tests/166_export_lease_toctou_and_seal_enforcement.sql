-- 166_export_lease_toctou_and_seal_enforcement:
-- DOGFOOD-STABILIZATION-06 defects I, III and IV on the V114 protocol.
--
-- Defect I (claim/lease TOCTOU): the stale listing is only a candidate set —
-- the atomic claim must RE-VALIDATE the live lease inside the same
-- conditional UPDATE:
--   T1. stale-list → renew → claim: the claim LOSES (the renewed lease is
--       re-read after the listing) and no object may be touched;
--   T2. stale-list → re-record of the SAME attempt → claim: the claim LOSES;
--   T3. claim wins first → renew returns 0 rows, and every pointer publish
--       (complete_export AND fail_export_with_object) is refused with the
--       pointer rolled back — including a REAL row-lock race between the
--       committed claim and a renew (two connections, lock_timeout);
--   T4. two schedulers claiming one row: exactly one winner (atomic
--       single-row UPDATE).
--
-- Defect III (seal-enforced intent): for p_object_key <> NULL,
-- complete_export / fail_export_with_object require EXACTLY ONE matching
-- OPEN intent (owner, export, key all equal), consumed in the same
-- transaction; every other shape rolls the pointer back:
--   S1. no intent → READY seal refused, export stays PENDING, no pointer;
--   S2. no intent → FAILED-with-pointer refused likewise;
--   S3. wrong shapes: cross-owner key, wrong-digest key (intent mismatch) —
--       refused, no pointer;
--   S4. CLAIMED intent → refused, no pointer;
--   S5. the correct OPEN intent seals and consumes EXACTLY one row;
--   S6. inline payload mode still requires no intent.
--
-- Defect IV (tombstone retirement): a CLAIMED tombstone of an EARLIER
-- attempt survives a later attempt's seal (different fence digest), and
-- retires only past the provably-safe boundary:
--   R1. fresh claim window → retire refuses (age floor);
--   R2. a pointer on the key → retire refuses;
--   R3. terminal export + no pointer + window past → the row is deleted,
--       and a late put under the retired key has NO record (prefix-audit
--       convergence).
--
-- PG 18 dblink/psql rules (same as 163/165): dblink connections established
-- BEFORE any role games; a fresh BEGIN + SET LOCAL lock_timeout must wrap
-- every remote probe; the intent table is SD-only — vc_api never touches it
-- directly, the harness reads/ages rows as superuser.

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

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
VALUES (1, 1, 'gentle-listener', true), (2, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
VALUES (1, 1, 1, NULL), (2, 1, 1, NULL);

-- One PENDING export for owner 1 carries defect I end to end (id via GUC).
BEGIN;
SELECT vc.set_owner_context(1, 'n0', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n0', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-166-t') INTO v_id;
    PERFORM set_config('vc.t_export_id', v_id::text, false);
    PERFORM vc.record_export_upload_intent(
        1, v_id, 'exports/1/' || v_id || '-aaaaaaaaaaaaaaaa.json', 0);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-aaaaaaaaaaaaaaaa.json';
    PERFORM set_config('vc.t_intent_id', v_id::text, false);
END;
$$;

-- ---------------------------------------------------------------------------
-- T1: the lease expired and was LISTED; the worker then renews. The stale
-- candidate's claim re-reads the LIVE lease inside its atomic UPDATE and
-- must lose — no key returned, nothing to delete.
-- ---------------------------------------------------------------------------
UPDATE vc.export_upload_intent
   SET lease_expires_at = now() - interval '20 minutes'
 WHERE id = current_setting('vc.t_intent_id')::bigint;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0)
     WHERE out_id = current_setting('vc.t_intent_id')::bigint;
    IF n <> 1 THEN
        RAISE EXCEPTION 'T1: the expired intent must be listed first, got %', n;
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.t_export_id')::bigint;
BEGIN
    IF vc.renew_export_upload_lease(1, v_e,
           'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 600) <> 1 THEN
        RAISE EXCEPTION 'T1: renew must re-arm the live lease';
    END IF;
END;
$$;
COMMIT;
DO $$
BEGIN
    -- The OLD candidate (listed against the expired lease) now claims with
    -- the SAME grace the listing used: the live lease defeats it atomically.
    IF vc.claim_export_upload_intent(1,
            current_setting('vc.t_intent_id')::bigint, 0) IS NOT NULL THEN
        RAISE EXCEPTION 'T1: the claim after a renew must lose';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent
                    WHERE id = current_setting('vc.t_intent_id')::bigint
                      AND state = 'OPEN') THEN
        RAISE EXCEPTION 'T1: the lost claim must leave the row OPEN';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- T2: the same defeat via a re-record of the SAME attempt key (a worker
-- retry pushes the lease out): the stale candidate loses again.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.t_export_id')::bigint;
BEGIN
    PERFORM vc.record_export_upload_intent(
        1, v_e, 'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 600);
END;
$$;
COMMIT;
DO $$
BEGIN
    IF vc.claim_export_upload_intent(1,
            current_setting('vc.t_intent_id')::bigint, 0) IS NOT NULL THEN
        RAISE EXCEPTION 'T2: the claim after a re-record must lose';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- T3: the claim WINS. Every later worker write on this attempt is fenced:
-- renew returns 0 rows, and both pointer publishes raise with the pointer
-- rolled back. The row-lock leg is a REAL two-connection race: a renew
-- racing the in-flight claim waits on the row lock (lock_timeout), and
-- after the claim commits the renewed lease can never resurrect the row.
-- ---------------------------------------------------------------------------
UPDATE vc.export_upload_intent
   SET lease_expires_at = now() - interval '20 minutes'
 WHERE id = current_setting('vc.t_intent_id')::bigint;
SELECT dblink_connect('claimconn', 'dbname=vc user=postgres password=vc');
SELECT dblink_exec('claimconn', 'BEGIN');
SELECT dblink_exec('claimconn', format(
    'DO $a$ BEGIN
        IF vc.claim_export_upload_intent(1, %s, 0) IS NULL THEN
            RAISE EXCEPTION ''T3: the claim must win the expired lease'';
        END IF;
    END $a$;', current_setting('vc.t_intent_id')));
-- The renew races the uncommitted claim on the row lock and times out —
-- a real contention proof, not a sleep. (renew is an owner-bound SD call, so
-- the probe carries the owner context before the role switch.)
BEGIN;
SET LOCAL lock_timeout = '400ms';
SELECT vc.set_owner_context(1, 'n3x', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3x', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.t_export_id')::bigint;
BEGIN
    BEGIN
        PERFORM vc.renew_export_upload_lease(1, v_e,
            'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 600);
        RAISE EXCEPTION 'T3: the racing renew must wait for the open claim';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%must wait%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%lock timeout%' THEN
            RAISE EXCEPTION 'T3: unexpected racing renew error %', SQLERRM;
        END IF;
    END;
END;
$$;
ROLLBACK;
-- The claim commits; the renew retry now reads the CLAIMED row and FAILS.
SELECT dblink_exec('claimconn', 'COMMIT');
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.t_export_id')::bigint;
BEGIN
    IF vc.renew_export_upload_lease(1, v_e,
           'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 600) <> 0 THEN
        RAISE EXCEPTION 'T3: renew after a committed claim must fail (0 rows)';
    END IF;
    BEGIN
        PERFORM vc.complete_export(1, v_e, NULL, now() + interval '1 hour',
            'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 10);
        RAISE EXCEPTION 'T3: READY publish after a claim unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'T3: READY publish error %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM vc.fail_export_with_object(1, v_e,
            'exports/1/' || v_e || '-aaaaaaaaaaaaaaaa.json', 10, 'export-failed');
        RAISE EXCEPTION 'T3: FAILED-pointer publish after a claim unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'T3: FAILED-pointer publish error %', SQLERRM;
        END IF;
    END;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.t_export_id')::bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE id = v_e AND (status <> 'PENDING' OR object_key IS NOT NULL)) THEN
        RAISE EXCEPTION 'T3: every refused publish must roll the pointer back';
    END IF;
END;
$$;
SELECT dblink_disconnect('claimconn');

-- ---------------------------------------------------------------------------
-- T4: two schedulers claim one row — exactly one winner. A FRESH attempt of
-- the still-PENDING export supplies the row (the earlier digest is already
-- CLAIMED); the plain FAILED terminal afterwards consumes everything and
-- frees the one-in-flight slot for defect III.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.t_export_id')::bigint;
BEGIN
    PERFORM vc.record_export_upload_intent(
        1, v_e, 'exports/1/' || v_e || '-8888888888888888.json', 0);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-8888888888888888.json';
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() - interval '20 minutes'
     WHERE id = v_id;
    IF vc.claim_export_upload_intent(1, v_id, 0) IS NULL THEN
        RAISE EXCEPTION 'T4: the first scheduler must win the expired lease';
    END IF;
    IF vc.claim_export_upload_intent(1, v_id, 0) IS NOT NULL THEN
        RAISE EXCEPTION 'T4: the second scheduler must lose';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 'n4b', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|n4b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.fail_export(1, current_setting('vc.t_export_id')::bigint, 'export-failed');
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- S1/S2: an object-mode seal with NO intent row at all is refused — both the
-- READY publish and the FAILED-with-pointer fallback — and the export keeps
-- NO pointer (still PENDING).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 's1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 's1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-166-s1') INTO v_e;
    PERFORM set_config('vc.s_export_id', v_e::text, false);
    BEGIN
        PERFORM vc.complete_export(1, v_e, NULL, now() + interval '1 hour',
            'exports/1/' || v_e || '-0123456789abcdef.json', 10);
        RAISE EXCEPTION 'S1: READY seal without an intent unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'S1: READY-without-intent error %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM vc.fail_export_with_object(1, v_e,
            'exports/1/' || v_e || '-0123456789abcdef.json', 10, 'export-failed');
        RAISE EXCEPTION 'S2: FAILED-pointer without an intent unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'S2: FAILED-without-intent error %', SQLERRM;
        END IF;
    END;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE id = v_e AND (status <> 'PENDING' OR object_key IS NOT NULL)) THEN
        RAISE EXCEPTION 'S1/S2: refused seals must leave no pointer';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- S3: wrong shapes. (a) a cross-owner key is rejected by the seal's own key
-- binding; (b) a correctly-shaped key with a DIFFERENT digest than the
-- recorded intent row is an intent mismatch — the pointer is refused.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 's3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 's3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
BEGIN
    BEGIN
        PERFORM vc.complete_export(1, v_e, NULL, now() + interval '1 hour',
            'exports/2/99-0123456789abcdef.json', 10);
        RAISE EXCEPTION 'S3a: cross-owner key unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%not bound%' THEN
            RAISE EXCEPTION 'S3a: cross-owner seal error %', SQLERRM;
        END IF;
    END;
    -- The correctly recorded intent for THIS attempt...
    PERFORM vc.record_export_upload_intent(
        1, v_e, 'exports/1/' || v_e || '-0123456789abcdef.json');
    -- ...but the seal publishes a DIFFERENT digest of the same export: the
    -- key shape is valid, the intent row is not — refused.
    BEGIN
        PERFORM vc.complete_export(1, v_e, NULL, now() + interval '1 hour',
            'exports/1/' || v_e || '-ffffffffffffffff.json', 10);
        RAISE EXCEPTION 'S3b: digest-mismatched seal unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'S3b: digest-mismatched seal error %', SQLERRM;
        END IF;
    END;
    BEGIN
        PERFORM vc.fail_export_with_object(1, v_e,
            'exports/1/' || v_e || '-ffffffffffffffff.json', 10, 'export-failed');
        RAISE EXCEPTION 'S3c: digest-mismatched fallback unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'S3c: digest-mismatched fallback error %', SQLERRM;
        END IF;
    END;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE id = v_e AND (status <> 'PENDING' OR object_key IS NOT NULL)) THEN
        RAISE EXCEPTION 'S3: refused seals must leave no pointer';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent
                    WHERE owner_user_id = 1 AND export_id = v_e
                      AND state = 'OPEN') THEN
        RAISE EXCEPTION 'S3: the recorded intent row must survive the refusals';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- S4/S5: a CLAIMED intent refuses the fallback publish; the correct OPEN
-- intent then seals READY consuming EXACTLY one row (the CLAIMED residue of
-- an earlier attempt of the SAME export stays for defect IV below).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 's4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 's4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
BEGIN
    PERFORM vc.record_export_upload_intent(
        1, v_e, 'exports/1/' || v_e || '-9999999999999999.json', 0);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
    v_id bigint;
BEGIN
    SELECT id INTO v_id FROM vc.export_upload_intent
     WHERE owner_user_id = 1 AND object_key LIKE '%-9999999999999999.json';
    PERFORM set_config('vc.s_claimed_intent', v_id::text, false);
    UPDATE vc.export_upload_intent
       SET lease_expires_at = now() - interval '20 minutes'
     WHERE id = v_id;
    IF vc.claim_export_upload_intent(1, v_id, 0) IS NULL THEN
        RAISE EXCEPTION 'S4: the expired earlier attempt must be claimable';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(1, 's5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 's5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
BEGIN
    -- S4: publishing the CLAIMED digest is refused (pointer rolled back).
    BEGIN
        PERFORM vc.fail_export_with_object(1, v_e,
            'exports/1/' || v_e || '-9999999999999999.json', 10, 'export-failed');
        RAISE EXCEPTION 'S4: CLAIMED-intent fallback unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%no single OPEN upload intent%' THEN
            RAISE EXCEPTION 'S4: CLAIMED-intent fallback error %', SQLERRM;
        END IF;
    END;
    -- S5: the CORRECT OPEN intent seals READY, consuming exactly its row.
    IF vc.complete_export(1, v_e, NULL, now() + interval '1 hour',
           'exports/1/' || v_e || '-0123456789abcdef.json', 42) <> 1 THEN
        RAISE EXCEPTION 'S5: the matching OPEN intent must seal';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vc.export_request
                    WHERE id = v_e AND status = 'READY'
                      AND object_key = 'exports/1/' || v_e || '-0123456789abcdef.json') THEN
        RAISE EXCEPTION 'S5: the READY pointer must be published exactly once';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent
                WHERE owner_user_id = 1 AND export_id = v_e
                  AND object_key = 'exports/1/' || v_e || '-0123456789abcdef.json') THEN
        RAISE EXCEPTION 'S5: the seal must consume exactly its intent row';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- S6: inline payload mode keeps requiring NO intent (V42 semantics).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(1, 's6', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 's6', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-166-s6') INTO v_e;
    IF vc.complete_export(1, v_e, '{"inline":true}', now() + interval '1 hour') <> 1 THEN
        RAISE EXCEPTION 'S6: the inline seal must not require an intent';
    END IF;
    PERFORM vc.fail_export(1, v_e, 'export-failed');
END;
$$;
COMMIT;

-- ---------------------------------------------------------------------------
-- Defect IV: the CLAIMED tombstone of the earlier attempt (-9999…) survives
-- the later attempt's READY seal (different digest) and retires only past
-- the provably-safe boundary.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_e bigint := current_setting('vc.s_export_id')::bigint;
    v_id bigint := current_setting('vc.s_claimed_intent')::bigint;
    v_key text := 'exports/1/' || v_e || '-9999999999999999.json';
    n int;
BEGIN
    -- The tombstone exists, the export is terminal (READY), and NO pointer
    -- references the tombstone's key (the pointer is the sealed digest).
    IF NOT EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE id = v_id
                    AND state = 'CLAIMED') THEN
        RAISE EXCEPTION 'R0: the earlier attempt''s tombstone must exist';
    END IF;
    -- R1: the claim window is fresh (floor 60s regardless of min_age 0) —
    -- a late put may still be in flight, retirement refuses.
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 0 THEN
        RAISE EXCEPTION 'R1: a fresh claim window must not retire';
    END IF;
    -- R2: a pointer ON the tombstone's key keeps it (fabricate one on a
    -- terminal row the sweeps own; the pointer check is what matters).
    UPDATE vc.export_request
       SET object_key = v_key
     WHERE owner_user_id = 1 AND id = (
         SELECT id FROM vc.export_request
          WHERE owner_user_id = 1 AND status = 'FAILED' AND object_key IS NULL
          ORDER BY id LIMIT 1);
    UPDATE vc.export_upload_intent
       SET claimed_at = now() - interval '20 minutes'
     WHERE id = v_id;
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 0 THEN
        RAISE EXCEPTION 'R2: a pointer on the key must keep the tombstone';
    END IF;
    UPDATE vc.export_request
       SET object_key = NULL
     WHERE owner_user_id = 1 AND object_key = v_key;
    -- R3: terminal export + no pointer + window past — the row retires, and
    -- a late put under the retired key has NO record at all (prefix-audit
    -- convergence, same as after the account-deletion cascade).
    IF vc.retire_export_upload_tombstone(1, v_id, 0) <> 1 THEN
        RAISE EXCEPTION 'R3: past the boundary the tombstone must retire';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE id = v_id) THEN
        RAISE EXCEPTION 'R3: the retired row must be deleted';
    END IF;
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'R3: a late put under the retired key must have no record';
    END IF;
    -- The sealed pointer's object stays protected throughout.
    IF NOT vc.export_object_has_record(
            'exports/1/' || v_e || '-0123456789abcdef.json') THEN
        RAISE EXCEPTION 'R3: the sealed object must keep its record';
    END IF;
END;
$$;

RESET vc.t_export_id;
RESET vc.t_intent_id;
RESET vc.s_export_id;
RESET vc.s_claimed_intent;
