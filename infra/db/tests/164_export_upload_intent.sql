-- 164_export_upload_intent: DOGFOOD-STABILIZATION-04/05 — the V114
-- upload-intent rows are the durable consumer for crash-after-put export
-- objects, driven through the 05 fenced protocol.
--
-- Covers:
--   * record_export_upload_intent creates the row (owner-bound, idempotent)
--     and refuses under an active deletion intent;
--   * a successful complete_export seal DELETES the matching intent row in
--     the same transaction (no reconciliation work for sealed objects);
--   * fail_export_with_object (the durable-pointer fallback) also retires
--     the intent row;
--   * the stale worklist honours the grace window (lease), excludes
--     pointer-carrying keys, excludes deleting owners, and is bounded;
--   * the reclaim goes through the atomic claim (a lost claim never deletes;
--     the 165 file proves the full race timelines);
--   * list_owner_export_objects UNIONs the intent keys (the pre-cascade
--     account-deletion cleanup sees crash-after-put orphans), and
--     clear_export_object removes the intent rows for the cleared key.

\set ON_ERROR_STOP on

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

-- Phase 1: the worker records the planned put right before the upload, for a
-- PENDING export (id via session GUC — psql cannot interpolate :vars inside
-- dollar-quoted bodies). The attempt segment of the key is a 16-hex fence
-- digest (V114 binding validation).
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export  bigint;
    v_intent  bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-e-1') INTO v_export;
    PERFORM set_config('vc.upload_export_id', v_export::text, false);

    SELECT vc.record_export_upload_intent(
        1, v_export, 'exports/1/' || v_export || '-aaaaaaaaaaaaaaaa.json') INTO v_intent;
    IF v_intent IS NULL OR v_intent <= 0 THEN
        RAISE EXCEPTION 'record must return the intent id';
    END IF;
    -- Idempotent re-record of the SAME key resolves the SAME row.
    IF vc.record_export_upload_intent(
            1, v_export, 'exports/1/' || v_export || '-aaaaaaaaaaaaaaaa.json') <> v_intent THEN
        RAISE EXCEPTION 're-record must resolve the existing row';
    END IF;
END;
$$;
COMMIT;

-- Phase 2: the stale worklist honours the grace window (row is fresh).
BEGIN;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0);
    IF n <> 1 THEN
        RAISE EXCEPTION 'zero-grace worklist must list the fresh row, got %', n;
    END IF;
    -- With a grace window the row is protected.
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 3600);
    IF n <> 0 THEN
        RAISE EXCEPTION 'the grace window must protect the fresh row, got %', n;
    END IF;
END;
$$;
ROLLBACK;

-- Phase 3: expire the row's lease (a claimant that crashed 20 minutes ago),
-- then a SECOND claimant takes over: it records its own intent, seals READY,
-- and the seal DELETES only its own intent — the crashed claimant's row is
-- reclaimed through the atomic claim.
UPDATE vc.export_upload_intent
   SET lease_expires_at = now() - interval '20 minutes'
 WHERE owner_user_id = 1 AND object_key LIKE '%-aaaaaaaaaaaaaaaa.json';
BEGIN;
SELECT vc.set_owner_context(1, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint := current_setting('vc.upload_export_id')::bigint;
    v_intent bigint;
    n        int;
BEGIN
    PERFORM vc.record_export_upload_intent(
        1, v_export, 'exports/1/' || v_export || '-bbbbbbbbbbbbbbbb.json');
    IF vc.complete_export(
            1, v_export, NULL, now() + interval '1 hour',
            'exports/1/' || v_export || '-bbbbbbbbbbbbbbbb.json', 321) <> 1 THEN
        RAISE EXCEPTION 'takeover seal must succeed';
    END IF;
    -- The sealed key's intent row retired with the seal; the crashed
    -- claimant's expired row survives it. The runtime-reachable view of
    -- both facts is the granted reclaim worklist (vc_api holds no direct
    -- table privileges on the intent table): the pointer-carrying sealed
    -- key is NOT listed, the pointer-less crashed key IS.
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0);
    IF n <> 1 THEN
        RAISE EXCEPTION 'worklist must hold only the pointer-less key, got %', n;
    END IF;
    SELECT out_id INTO v_intent FROM vc.stale_export_upload_intents(100, 0) w
     WHERE w.out_object_key = 'exports/1/' || v_export || '-aaaaaaaaaaaaaaaa.json';
    IF v_intent IS NULL THEN
        RAISE EXCEPTION 'the crashed claimant''s key must be listed';
    END IF;
    -- Reclamation via the ATOMIC claim: exactly one winner, and after the
    -- claim the row leaves the stale worklist (it is a CLAIMED tombstone
    -- now, owned by the re-sweep cadence).
    IF vc.claim_export_upload_intent(1, v_intent) IS DISTINCT FROM
       'exports/1/' || v_export || '-aaaaaaaaaaaaaaaa.json' THEN
        RAISE EXCEPTION 'the reclaim claim must win and return the key';
    END IF;
    IF vc.claim_export_upload_intent(1, v_intent) IS NOT NULL THEN
        RAISE EXCEPTION 'a second claim of the same row must lose';
    END IF;
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0);
    IF n <> 0 THEN
        RAISE EXCEPTION 'worklist must be empty after the claim, got %', n;
    END IF;
    -- Tombstone bookkeeping is reentrant (a vanished row reports 0, the
    -- maintenance delete of an absent row reports 0 too).
    IF vc.mark_export_upload_intent_swept(1, v_intent) <> 1 THEN
        RAISE EXCEPTION 'sweep bookkeeping must mark the tombstone';
    END IF;
    IF vc.delete_export_upload_intent(1, 999999999) <> 0 THEN
        RAISE EXCEPTION 'maintenance delete of an absent row must be 0';
    END IF;
END;
$$;
COMMIT;

-- Phase 4: the durable FAILED-with-pointer fallback retires its intent too,
-- and clear_export_object (the sweep after an object delete) removes the
-- intent rows of the cleared key — exercised on a fresh PENDING export,
-- since a terminalized export refuses new intent records (05 fencing).
BEGIN;
SELECT vc.set_owner_context(1, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint;
    v_second bigint;
    n        int;
BEGIN
    -- A second export for the SAME owner needs the first one terminal: the
    -- Phase-3 seal left it READY, so expire it first (V42/V109 sweep).
    PERFORM vc.expire_stale_exports();
    SELECT vc.create_export_request(1, 'tok-e-2') INTO v_export;
    PERFORM vc.record_export_upload_intent(
        1, v_export, 'exports/1/' || v_export || '-cccccccccccccccc.json');
    IF vc.fail_export_with_object(
            1, v_export, 'exports/1/' || v_export || '-cccccccccccccccc.json', 99,
            'export-failed') <> 1 THEN
        RAISE EXCEPTION 'pointer fallback must succeed';
    END IF;
    -- The fallback retired its intent row: the key is pointer-carrying AND
    -- row-less, so the reclaim worklist stays empty.
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0);
    IF n <> 0 THEN
        RAISE EXCEPTION 'the fallback must retire its intent row, worklist %', n;
    END IF;
    -- clear_export_object removes the pointer AND any intent row still
    -- holding the same key (a fresh PENDING export supplies the row — a
    -- FAILED export refuses new records under the 05 fencing).
    SELECT vc.create_export_request(1, 'tok-e-3') INTO v_second;
    PERFORM vc.record_export_upload_intent(
        1, v_second, 'exports/1/' || v_second || '-dddddddddddddddd.json');
    IF vc.clear_export_object(
            1, v_second, 'exports/1/' || v_second || '-dddddddddddddddd.json') < 1 THEN
        RAISE EXCEPTION 'clear must affect the intent row';
    END IF;
    -- Free the one-in-flight slot for Phase 5 (clear touches the pointer and
    -- the intent rows, not the status).
    PERFORM vc.fail_export(1, v_second, 'export-failed');
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0);
    IF n <> 0 THEN
        RAISE EXCEPTION 'clear must leave no reclaimable rows, got %', n;
    END IF;
END;
$$;
COMMIT;

-- Phase 5: the pre-cascade account-deletion worklist UNIONs intent keys —
-- a crash-after-put orphan is visible BEFORE the cascade destroys the rows;
-- and under the deletion intent, recording a NEW upload intent is refused.
BEGIN;
SELECT vc.set_owner_context(1, 'n5a', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint;
BEGIN
    SELECT vc.create_export_request(1, 'tok-e-4') INTO v_export;
    PERFORM set_config('vc.upload_export_id', v_export::text, false);
    PERFORM vc.record_export_upload_intent(
        1, v_export, 'exports/1/' || v_export || '-eeeeeeeeeeeeeeee.json');
END;
$$;
COMMIT;
INSERT INTO vc.account_deletion_intent(account_id, username_digest)
VALUES (1, repeat('b', 64));
BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.list_owner_export_objects(1)
     WHERE out_object_key LIKE '%-eeeeeeeeeeeeeeee.json';
    IF n <> 1 THEN
        RAISE EXCEPTION 'the worklist must include the intent-sourced key, got %', n;
    END IF;
    -- Deleting owners are the deletion cleanup's business: the reclaim
    -- worklist excludes them (and so never races the cascade).
    SELECT count(*) INTO n FROM vc.stale_export_upload_intents(100, 0);
    IF n <> 0 THEN
        RAISE EXCEPTION 'deleting owner must be excluded from reclaim, got %', n;
    END IF;
    BEGIN
        PERFORM vc.record_export_upload_intent(
            1, current_setting('vc.upload_export_id')::bigint,
            'exports/1/' || current_setting('vc.upload_export_id') || '-dddddddddddddddd.json');
        RAISE EXCEPTION 'record under deletion intent unexpectedly allowed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly allowed%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%deletion%' THEN
            RAISE EXCEPTION 'unexpected record error: %', SQLERRM;
        END IF;
    END;
END;
$$;
ROLLBACK;

-- Owner 2 is untouched throughout.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'owner 2 must never appear';
    END IF;
END;
$$;

-- Cleanup (shared sequential database): drop the deletion intent so later
-- tests see a clean owner 1, and the session GUCs used above.
DELETE FROM vc.account_deletion_intent WHERE account_id = 1;
RESET vc.upload_export_id;
