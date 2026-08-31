-- 168_export_deleted_owner_fence_convergence:
-- DOGFOOD-STABILIZATION-08 defects A and B against REAL PostgreSQL (the
-- account-deletion cascade is executed for real; no fake row surgery).
--
-- Defect A (deleted-owner orphan fence):
--   E1. an owner with a LIVE upload (WRITER fence + OPEN intent) is deleted
--       by the real cascade — the intent/export rows die, the fence row
--       survives ORPHANED (ON DELETE SET NULL, holder still WRITER);
--       fence_export_orphan_reclaim must TAKE THE ORPHAN OVER (true, no FK
--       exception), stay reentrant (re-arm true) and finally clear — the
--       late object under exports/{deletedOwner}/... is convergable;
--   E2. the clean path: after the coordinator-style cleanup left no fence
--       row at all, the audit fences the deleted owner's key OWNERLESS
--       from scratch (true), repeatedly (idempotent).
--
-- Defect B (atomic in-fence re-verification — objectHasRecord is a
-- pre-filter only, never the deletion grant):
--   E3. stale prefilter → worker completes record + seal READY → the
--       audit's fence call REFUSES (false, the READY pointer is seen
--       inside the fence transaction) and leaves no placeholder — the
--       pointer and its object both stay;
--   E4. the reverse order: audit holds the RECLAIM fence first → the
--       worker's record RAISES before any put → the audit may clear and
--       the export terminalizes — never a seal over an audit-deleted key.
--
-- Harness rules (same as 163/165/166/167): dblink-free owner binding via
-- session GUC + set_owner_context inside short BEGIN/COMMIT blocks; the
-- SD-only tables (fence/intent/export) are read and aged as superuser.

\set ON_ERROR_STOP on

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

INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob'), (3, 'carol'),
                                                (4, 'dave');
INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active) VALUES
    (2, 1, 'gentle-listener', true), (3, 1, 'gentle-listener', true),
    (4, 1, 'gentle-listener', true);
INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title) VALUES
    (2, 1, 1, NULL), (3, 1, 1, NULL), (4, 1, 1, NULL);

-- ---------------------------------------------------------------------------
-- E1: live upload → REAL account-deletion cascade → orphaned WRITER fence
-- taken over by the audit.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(2, 'e1a', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e1a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(2, 'tok-168-e1') INTO v_e;
    PERFORM set_config('vc.e1_export_id', v_e::text, false);
    PERFORM set_config('vc.e1_key',
        'exports/2/' || v_e || '-0123456789abcdef.json', false);
    PERFORM vc.record_export_upload_intent(2, v_e,
        'exports/2/' || v_e || '-0123456789abcdef.json', 90);
END;
$$;
COMMIT;

-- The real cascade (superuser; the coordinator's object cleanup is
-- deliberately BYPASSED — this is the pathological crash window where the
-- account deletion commits while a worker's fence is still live).
DELETE FROM vc.vc_user WHERE id = 2;

DO $$
DECLARE
    v_e   bigint := current_setting('vc.e1_export_id')::bigint;
    v_key text   := current_setting('vc.e1_key');
BEGIN
    -- The owner, the export row (pointer state) and the intent row are all
    -- GONE; only the orphaned fence survives.
    IF EXISTS (SELECT 1 FROM vc.vc_user WHERE id = 2) THEN
        RAISE EXCEPTION 'E1: the owner must be deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_request WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'E1: the export pointer state must be cascade-deleted';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE owner_user_id = 2) THEN
        RAISE EXCEPTION 'E1: the intent row must be cascade-deleted';
    END IF;
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'E1: the late object must be unrecorded after the cascade';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_object_fence
                    WHERE object_key = v_key
                      AND holder = 'WRITER' AND owner_user_id IS NULL) THEN
        RAISE EXCEPTION 'E1: the fence must survive the cascade orphaned (SET NULL)';
    END IF;
    -- THE 08 defect-A proof: the audit fences the deleted owner's key —
    -- the orphaned WRITER is TAKEN OVER (no FK exception, no permanent
    -- blocker). The in-fence re-verification passes: no record exists.
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E1: the audit must take over the orphaned writer fence';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_object_fence
                WHERE object_key = v_key AND holder <> 'RECLAIM') THEN
        RAISE EXCEPTION 'E1: the takeover must leave a RECLAIM holder';
    END IF;
    -- The scheduler deletes the object (real-MinIO proof lives in the legacy runtime
    -- combination test), then releases; re-arming is idempotent.
    IF vc.clear_export_orphan_reclaim(v_key) <> 1 THEN
        RAISE EXCEPTION 'E1: the audit must release its fence';
    END IF;
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E1: re-fencing the deleted owner''s key must succeed';
    END IF;
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E1: the RECLAIM re-arm must be reentrant';
    END IF;
    PERFORM vc.clear_export_orphan_reclaim(v_key);
    IF EXISTS (SELECT 1 FROM vc.export_object_fence WHERE object_key = v_key) THEN
        RAISE EXCEPTION 'E1: the fence must be finally clearable';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- E2: the clean deleted-owner path — NO fence row at all (the coordinator
-- cleanup released it before the cascade); the audit fences the key
-- OWNERLESS from scratch, again and again (idempotent).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(3, 'e2a', encode(vc.hmac(convert_to('vc-owner-binding-v1|3|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e2a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(3, 'tok-168-e2') INTO v_e;
    PERFORM set_config('vc.e2_export_id', v_e::text, false);
    PERFORM vc.record_export_upload_intent(3, v_e,
        'exports/3/' || v_e || '-1111111111111111.json', 90);
END;
$$;
COMMIT;
-- Coordinator-style cleanup: object delete (simulated) + clear_export_object
-- releases the pointer, the intent row AND the fence.
BEGIN;
SELECT vc.set_owner_context(3, 'e2b', encode(vc.hmac(convert_to('vc-owner-binding-v1|3|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e2b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.clear_export_object(3, current_setting('vc.e2_export_id')::bigint,
        'exports/3/' || current_setting('vc.e2_export_id') || '-1111111111111111.json');
END;
$$;
COMMIT;
DELETE FROM vc.vc_user WHERE id = 3;

DO $$
DECLARE
    v_key text := 'exports/3/' || current_setting('vc.e2_export_id')
                  || '-1111111111111111.json';
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_object_fence WHERE object_key = v_key) THEN
        RAISE EXCEPTION 'E2: the coordinator cleanup must leave no fence';
    END IF;
    -- A late object lands under the deleted owner's prefix: the fence is
    -- created OWNERLESS (no FK target exists) — never an exception.
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E2: the deleted owner''s key must be fenceable ownerless';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_object_fence
                WHERE object_key = v_key AND (holder <> 'RECLAIM'
                                              OR owner_user_id IS NOT NULL)) THEN
        RAISE EXCEPTION 'E2: the fresh fence must be an ownerless RECLAIM';
    END IF;
    PERFORM vc.clear_export_orphan_reclaim(v_key);
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E2: repeated convergence passes must keep succeeding';
    END IF;
    PERFORM vc.clear_export_orphan_reclaim(v_key);
END;
$$;

-- ---------------------------------------------------------------------------
-- E3 (08 defect B, forward order): the audit's stale prefilter said
-- "unrecorded" — then the worker finished record + put + seal READY. The
-- audit's fence call must REFUSE inside the fence transaction (the READY
-- pointer is re-read there) and leave no placeholder: the pointer and the
-- object both survive.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(4, 'e3a', encode(vc.hmac(convert_to('vc-owner-binding-v1|4|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e3a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    SELECT vc.create_export_request(4, 'tok-168-e3') INTO v_e;
    PERFORM set_config('vc.e3_export_id', v_e::text, false);
    PERFORM set_config('vc.e3_key',
        'exports/4/' || v_e || '-2222222222222222.json', false);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_key text := current_setting('vc.e3_key');
BEGIN
    -- The stale prefilter: no record yet (the worker has not recorded).
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'E3: the prefilter must see the key unrecorded';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(4, 'e3b', encode(vc.hmac(convert_to('vc-owner-binding-v1|4|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e3b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.e3_export_id')::bigint;
BEGIN
    -- The worker wins the race AFTER the prefilter: record + seal READY,
    -- all committed (the fence is released by the seal).
    PERFORM vc.record_export_upload_intent(4, v_e,
        'exports/4/' || v_e || '-2222222222222222.json', 90);
    IF vc.complete_export(4, v_e, NULL, now() + interval '1 hour',
           'exports/4/' || v_e || '-2222222222222222.json', 77) <> 1 THEN
        RAISE EXCEPTION 'E3: the worker''s seal must succeed';
    END IF;
END;
$$;
COMMIT;
DO $$
DECLARE
    v_e   bigint := current_setting('vc.e3_export_id')::bigint;
    v_key text   := current_setting('vc.e3_key');
BEGIN
    -- The audit's fence now: the fence itself is free (the seal released
    -- it), but the IN-FENCE re-verification sees the READY pointer — the
    -- call must return FALSE and leave no RECLAIM placeholder.
    IF vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E3: a READY pointer must refuse the reclaim fence';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_object_fence
                WHERE object_key = v_key AND holder = 'RECLAIM') THEN
        RAISE EXCEPTION 'E3: the refused fence must not leave a placeholder';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_request e
                    WHERE e.owner_user_id = 4 AND e.id = v_e
                      AND e.status = 'READY' AND e.object_key = v_key) THEN
        RAISE EXCEPTION 'E3: the READY pointer must be intact';
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- E4 (08 defect B, reverse order — must keep holding): the audit fences
-- FIRST; the worker's record is refused BEFORE its put; the audit clears
-- and the export terminalizes. A mid-flight WRITER also keeps refusing the
-- audit (D2 of 167, restated for the 08 fence shape).
-- ---------------------------------------------------------------------------
BEGIN;
SELECT vc.set_owner_context(4, 'e4a', encode(vc.hmac(convert_to('vc-owner-binding-v1|4|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e4a', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint;
BEGIN
    -- Owner 4's E3 export is READY (not PENDING), so a second request is
    -- accepted (the one-in-flight guard counts PENDING rows only).
    SELECT vc.create_export_request(4, 'tok-168-e4') INTO v_e;
    PERFORM set_config('vc.e4_export_id', v_e::text, false);
    PERFORM set_config('vc.e4_key',
        'exports/4/' || v_e || '-3333333333333333.json', false);
END;
$$;
COMMIT;
DO $$
DECLARE
    v_key text := current_setting('vc.e4_key');
BEGIN
    IF vc.export_object_has_record(v_key) THEN
        RAISE EXCEPTION 'E4: the pre-record key must be unrecorded';
    END IF;
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E4: the audit must hold the fence of an unrecorded key';
    END IF;
END;
$$;
BEGIN;
SELECT vc.set_owner_context(4, 'e4b', encode(vc.hmac(convert_to('vc-owner-binding-v1|4|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'e4b', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_e bigint := current_setting('vc.e4_export_id')::bigint;
BEGIN
    BEGIN
        PERFORM vc.record_export_upload_intent(4, v_e,
            current_setting('vc.e4_key'), 90);
        RAISE EXCEPTION 'E4: record against the audit''s fence unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%fenced for reclaim%' THEN
            RAISE EXCEPTION 'E4: unexpected fenced-record error %', SQLERRM;
        END IF;
    END;
    -- No put may happen for this key; the export terminalizes instead.
    PERFORM vc.fail_export(4, v_e, 'export-failed');
END;
$$;
COMMIT;
DO $$
DECLARE
    v_key text := current_setting('vc.e4_key');
BEGIN
    IF vc.clear_export_orphan_reclaim(v_key) <> 1 THEN
        RAISE EXCEPTION 'E4: the audit must release its fence after the delete';
    END IF;
    -- Convergence is repeatable end-to-end for the pathological writer.
    IF NOT vc.fence_export_orphan_reclaim(v_key) THEN
        RAISE EXCEPTION 'E4: the cleared key must be fenceable again';
    END IF;
    PERFORM vc.clear_export_orphan_reclaim(v_key);
END;
$$;

-- Owners 2/3 are gone, owner 4 keeps no fence rows.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.export_object_fence) THEN
        RAISE EXCEPTION 'cleanup: no fence row may survive the file';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_upload_intent WHERE owner_user_id = 4
                AND object_key = current_setting('vc.e3_key')) THEN
        RAISE EXCEPTION 'cleanup: the sealed key''s intent was consumed';
    END IF;
END;
$$;

RESET vc.e1_export_id;
RESET vc.e1_key;
RESET vc.e2_export_id;
RESET vc.e3_export_id;
RESET vc.e3_key;
RESET vc.e4_export_id;
RESET vc.e4_key;
