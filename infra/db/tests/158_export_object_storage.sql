-- 158_export_object_storage: DOGFOOD-02 (ADR-0006 §7.3) V109 — object-mode
-- data exports over the local MinIO bucket.
--
-- Covers: the object_key/object_bytes columns exist; complete_export seals
-- object mode (payload NULL, pointer written) and keeps the inline 4-arg
-- call shape working; the payload/object_key guards (both NULL, both set,
-- key without bytes all RAISE); consume_export returns the object pointer
-- once and is still one-time (ROW_COUNT hit detection — an object-mode row
-- has a NULL payload); expire_stale_exports purges payload/token but KEEPS
-- object_key for the application sweep; the sweep pair
-- list_expired_export_objects/clear_export_object closes the loop (CAS on
-- the exact key); and the new functions stay vc_api-only.

\set ON_ERROR_STOP on

TRUNCATE vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- V109 columns exist on vc.export_request.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'vc' AND table_name = 'export_request'
                      AND column_name = 'object_key') THEN
        RAISE EXCEPTION 'V109 must add vc.export_request.object_key';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'vc' AND table_name = 'export_request'
                      AND column_name = 'object_bytes') THEN
        RAISE EXCEPTION 'V109 must add vc.export_request.object_bytes';
    END IF;
END $$;

-- Owner-scoped path: object-mode seal, pointer-only consume, one-time token.
BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export  bigint;
    v_payload text;
    v_key     text;
    v_bytes   bigint;
    v_expires timestamptz;
    n         integer;
BEGIN
    v_export := vc.create_export_request(1, 'tok-obj-1');

    -- Object-mode seal (06 protocol): the fenced upload intent is recorded
    -- first, then the pointer is written and the intent consumed atomically
    -- in the same complete_export transaction. Payload stays NULL. (The
    -- column values themselves are asserted in the superuser block below —
    -- vc_api has no table-level SELECT; the pointer comes back through
    -- consume.)
    PERFORM vc.record_export_upload_intent(
        1, v_export, 'exports/1/' || v_export || '-0123456789abcdef.json');
    n := vc.complete_export(1, v_export, NULL, now() + interval '1 hour',
                            'exports/1/' || v_export || '-0123456789abcdef.json', 2048);
    IF n <> 1 THEN
        RAISE EXCEPTION 'object-mode complete_export must seal one row (got %)', n;
    END IF;

    -- One-time consume in object mode: the pointer (not the payload) comes
    -- back exactly once — a NULL payload must not read as a miss.
    SELECT out_payload, out_object_key, out_object_bytes, out_expires_at
      INTO v_payload, v_key, v_bytes, v_expires
      FROM vc.consume_export(1, v_export, 'tok-obj-1');
    IF v_payload IS NOT NULL
       OR v_key IS DISTINCT FROM 'exports/1/' || v_export || '-0123456789abcdef.json'
       OR v_bytes IS DISTINCT FROM 2048 OR v_expires IS NULL THEN
        RAISE EXCEPTION 'object-mode consume must return the pointer once (payload=%/key=%)', v_payload, v_key;
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_export, 'tok-obj-1');
    IF n <> 0 THEN
        RAISE EXCEPTION 'object-mode consume must be one-time';
    END IF;

    -- Guards: neither payload nor key; both; key without bytes.
    v_export := vc.create_export_request(1, 'tok-obj-2');
    BEGIN
        PERFORM vc.complete_export(1, v_export, NULL, now() + interval '1 hour',
                                   NULL, NULL);
        RAISE EXCEPTION 'complete_export without payload and key unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
    BEGIN
        PERFORM vc.complete_export(1, v_export, '{"x":1}', now() + interval '1 hour',
                                   'exports/1/x.json', 1);
        RAISE EXCEPTION 'complete_export with payload and key unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
    BEGIN
        PERFORM vc.complete_export(1, v_export, NULL, now() + interval '1 hour',
                                   'exports/1/x.json', NULL);
        RAISE EXCEPTION 'complete_export with key but no bytes unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;

    -- Inline compatibility: the V76 4-argument call shape still seals with
    -- the payload and a NULL pointer (columns asserted in the superuser
    -- block; here the payload round-trips through consume).
    n := vc.complete_export(1, v_export, '{"inline":true}', now() + interval '1 hour');
    IF n <> 1 THEN
        RAISE EXCEPTION 'inline complete_export must still seal (got %)', n;
    END IF;
    SELECT out_payload, out_object_key INTO v_payload, v_key
      FROM vc.consume_export(1, v_export, 'tok-obj-2');
    IF v_payload IS DISTINCT FROM '{"inline":true}' OR v_key IS NOT NULL THEN
        RAISE EXCEPTION 'inline consume must return the payload and no pointer';
    END IF;

    -- Foreign owner id RAISEs (trusted-owner assertion, unchanged).
    BEGIN
        PERFORM * FROM vc.consume_export(2, v_export, 'tok-obj-2');
        RAISE EXCEPTION 'foreign owner id unexpectedly consumed an object-mode export';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unexpectedly consumed%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- Expiry + sweep closure (superuser block: cross-owner maintenance).
BEGIN;
INSERT INTO vc.export_request(owner_user_id, id, status, requested_at, completed_at,
                              expires_at, download_token_hash, payload,
                              object_key, object_bytes)
VALUES (1, 9001, 'READY', now() - interval '2 hours', now() - interval '2 hours',
        now() - interval '1 hour',
        encode(vc.digest(convert_to('stale-obj-tok', 'UTF8'), 'sha256'), 'hex'),
        NULL, 'exports/1/9001.json', 512),
       (1, 9002, 'READY', now() - interval '2 hours', now() - interval '2 hours',
        now() - interval '1 hour',
        encode(vc.digest(convert_to('stale-inline-tok', 'UTF8'), 'sha256'), 'hex'),
        '{"stale":true}', NULL, NULL);
DO $$
DECLARE
    v_rows integer;
    n      integer;
BEGIN
    -- Column-level assertions for the owner-block seals (superuser reads;
    -- vc_api has no table-level SELECT).
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE owner_user_id = 1 AND id NOT IN (9001, 9002)
                  AND object_key IS NOT NULL
                  AND (payload IS NOT NULL OR object_bytes IS DISTINCT FROM 2048)) THEN
        RAISE EXCEPTION 'object-mode seal must store pointer only';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE owner_user_id = 1 AND id NOT IN (9001, 9002)
                  AND payload IS NOT NULL AND object_key IS NOT NULL) THEN
        RAISE EXCEPTION 'inline seal must not gain an object pointer';
    END IF;

    v_rows := vc.expire_stale_exports();
    IF v_rows <> 2 THEN
        RAISE EXCEPTION 'expire_stale_exports must expire both stale rows (got %)', v_rows;
    END IF;

    -- expire keeps the object pointer (deletion is the application's job);
    -- the inline payload is purged as before.
    IF NOT EXISTS (SELECT 1 FROM vc.export_request
                    WHERE owner_user_id = 1 AND id = 9001
                      AND status = 'EXPIRED' AND payload IS NULL
                      AND object_key = 'exports/1/9001.json'
                      AND object_bytes = 512) THEN
        RAISE EXCEPTION 'expired object-mode row must keep its pointer';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE owner_user_id = 1 AND id = 9002 AND object_key IS NOT NULL) THEN
        RAISE EXCEPTION 'inline rows must never gain an object pointer';
    END IF;

    -- The sweep worklist lists only EXPIRED rows with a pointer.
    SELECT count(*) INTO n FROM vc.list_expired_export_objects();
    IF n <> 1 THEN
        RAISE EXCEPTION 'sweep worklist must list exactly the pointer row (got %)', n;
    END IF;

    -- CAS clear: a wrong key moves nothing, the right key clears the pointer.
    v_rows := vc.clear_export_object(1, 9001, 'exports/1/wrong.json');
    IF v_rows <> 0 THEN
        RAISE EXCEPTION 'clear_export_object must refuse a mismatched key';
    END IF;
    v_rows := vc.clear_export_object(1, 9001, 'exports/1/9001.json');
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'clear_export_object must clear the matching pointer';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.list_expired_export_objects()) THEN
        RAISE EXCEPTION 'cleared row must leave the sweep worklist';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.export_request
                WHERE owner_user_id = 1 AND id = 9001
                  AND (object_key IS NOT NULL OR object_bytes IS NOT NULL)) THEN
        RAISE EXCEPTION 'clear_export_object must null both pointer columns';
    END IF;
END $$;
COMMIT;

-- The V109 functions stay vc_api-only.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.list_expired_export_objects();
    RAISE EXCEPTION 'vc_worker unexpectedly executed list_expired_export_objects';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
DO $$
BEGIN
    PERFORM vc.clear_export_object(1, 9001, 'exports/1/9001.json');
    RAISE EXCEPTION 'vc_worker unexpectedly executed clear_export_object';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected
END $$;
COMMIT;
RESET ROLE;
