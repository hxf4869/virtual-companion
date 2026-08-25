-- 160_export_object_lifecycle: DOGFOOD-STABILIZATION V110 — export object
-- lifecycle invariants (no pointer-less orphans, account-deletion worklist,
-- retention guard).
--
-- Covers: fail_export_with_object terminalizes PENDING as FAILED while
-- KEEPING the object pointer (and its owner-context + PENDING guards);
-- list_failed_export_objects lists FAILED-with-pointer rows only;
-- list_owner_export_objects lists every pointer-carrying row of one owner
-- (any status, bounded); retention_purge_export_residue SKIPS rows whose
-- object pointer is still live (deleting them would orphan the bucket
-- object) and purges pointer-less terminal rows as before; the new
-- functions stay vc_api-only.

\set ON_ERROR_STOP on

TRUNCATE vc.export_request, vc.export_upload_intent, vc.consent_record,
         vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice'), (2, 'bob');

-- Owner-scoped path: the no-orphan failure terminal.
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint;
    n        integer;
BEGIN
    v_export := vc.create_export_request(1, 'tok-lc-1');

    -- Durable pointer on failure (06 protocol): the fenced upload intent is
    -- recorded first, then PENDING -> FAILED consumes it with the pointer.
    PERFORM vc.record_export_upload_intent(
        1, v_export, 'exports/1/' || v_export || '-0123456789abcdef.json');
    n := vc.fail_export_with_object(
        1, v_export, 'exports/1/' || v_export || '-0123456789abcdef.json',
        1024, 'export-failed');
    IF n <> 1 THEN
        RAISE EXCEPTION 'fail_export_with_object must terminalize one PENDING row (got %)', n;
    END IF;

    -- Idempotence guard: a second call on the now-FAILED row moves nothing.
    n := vc.fail_export_with_object(
        1, v_export, 'exports/1/' || v_export || '-0123456789abcdef.json',
        1024, 'export-failed');
    IF n <> 0 THEN
        RAISE EXCEPTION 'fail_export_with_object must only act on PENDING rows';
    END IF;

    -- Guard clauses: blank key, negative bytes, foreign owner.
    v_export := vc.create_export_request(1, 'tok-lc-2');
    BEGIN
        PERFORM vc.fail_export_with_object(1, v_export, '  ', 10, 'e');
        RAISE EXCEPTION 'blank key unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        NULL;
    END;
    BEGIN
        PERFORM vc.fail_export_with_object(1, v_export, 'exports/1/x.json', -1, 'e');
        RAISE EXCEPTION 'negative bytes unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly accepted%' THEN RAISE; END IF;
        NULL;
    END;
    BEGIN
        PERFORM * FROM vc.fail_export_with_object(2, v_export, 'exports/2/x.json', 10, 'e');
        RAISE EXCEPTION 'foreign owner unexpectedly terminalized';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly terminalized%' THEN RAISE; END IF;
        NULL;
    END;
END $$;
COMMIT;
RESET ROLE;

-- Cross-owner maintenance worklists + retention guard (superuser block).
BEGIN;
-- Drop the owner-block row (a real identity export id) so the fixture below
-- is the complete table face.
DELETE FROM vc.export_request;
INSERT INTO vc.export_request(owner_user_id, id, status, requested_at, completed_at,
                              expires_at, download_token_hash, payload,
                              object_key, object_bytes)
VALUES (1, 9101, 'FAILED', now() - interval '3 hours', NULL, NULL, NULL, NULL,
        'exports/1/9101.json', 128),
       (1, 9102, 'FAILED', now() - interval '3 hours', NULL, NULL, NULL, NULL, NULL, NULL),
       (2, 9103, 'FAILED', now() - interval '3 hours', NULL, NULL, NULL, NULL,
        'exports/2/9103.json', 256),
       (1, 9104, 'READY', now() - interval '3 hours', now() - interval '3 hours',
        now() + interval '1 hour', NULL, NULL, 'exports/1/9104.json', 64);
DO $$
DECLARE
    n integer;
BEGIN
    -- FAILED worklist: only pointer-carrying FAILED rows, both owners.
    SELECT count(*) INTO n FROM vc.list_failed_export_objects();
    IF n <> 2 THEN
        RAISE EXCEPTION 'failed worklist must list exactly the 2 pointer rows (got %)', n;
    END IF;

    -- Owner worklist: every pointer-carrying row of one owner, any status.
    SELECT count(*) INTO n FROM vc.list_owner_export_objects(1);
    IF n <> 2 THEN
        RAISE EXCEPTION 'owner worklist must list the FAILED and READY pointer rows (got %)', n;
    END IF;
    SELECT count(*) INTO n FROM vc.list_owner_export_objects(2);
    IF n <> 1 THEN
        RAISE EXCEPTION 'owner worklist must list bob''s single pointer row (got %)', n;
    END IF;

    -- Retention guard: EXPORT_RESIDUE purge skips pointer-carrying rows and
    -- still deletes pointer-less terminal rows. (No policy activation is
    -- needed — the purge function is callable directly with a cutoff.)
    n := vc.retention_purge_export_residue(now());
    IF n <> 1 THEN
        RAISE EXCEPTION 'residue purge must delete only the pointer-less FAILED row (got %)', n;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_request WHERE id = 9102) THEN
        RAISE EXCEPTION 'pointer-less terminal row was not purged';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.export_request WHERE id IN (9101, 9103, 9104)) THEN
        RAISE EXCEPTION 'pointer rows must all survive the purge';
    END IF;
    -- Exactly the three pointer rows survive.
    SELECT count(*) INTO n FROM vc.export_request;
    IF n <> 3 THEN
        RAISE EXCEPTION 'exactly the 3 pointer rows must survive (got %)', n;
    END IF;

    -- After the sweep clears a pointer, the row becomes purgeable.
    PERFORM vc.clear_export_object(1, 9101, 'exports/1/9101.json');
    n := vc.retention_purge_export_residue(now());
    IF n <> 1 OR EXISTS (SELECT 1 FROM vc.export_request WHERE id = 9101) THEN
        RAISE EXCEPTION 'cleared pointer row must become purgeable';
    END IF;
END $$;
COMMIT;

-- The V110 functions stay vc_api-only.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.list_failed_export_objects();
    RAISE EXCEPTION 'vc_worker unexpectedly executed list_failed_export_objects';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
DO $$
BEGIN
    PERFORM * FROM vc.list_owner_export_objects(1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed list_owner_export_objects';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected
END $$;
DO $$
BEGIN
    PERFORM vc.fail_export_with_object(1, 1, 'exports/1/1.json', 1, 'e');
    RAISE EXCEPTION 'vc_worker unexpectedly executed fail_export_with_object';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected
END $$;
COMMIT;
RESET ROLE;
