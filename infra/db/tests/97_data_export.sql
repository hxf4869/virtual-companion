-- 97_data_export: DATA-EXPORT V42 — asynchronous user data export.
--
-- Covers: create_export_request enqueues a DATA_EXPORT work item and refuses
-- a second in-flight request; count_inflight_exports is the eager pre-check;
-- complete_export seals PENDING→READY with payload/token/expiry;
-- get_export_request exposes status + token (never the payload) and RAISEs
-- for a foreign owner; consume_export returns the payload exactly once;
-- expire_stale_exports purges expired READY rows (过期后自动删除); a
-- non-vc_api role cannot execute the functions; and create without a
-- server-trusted owner context RAISEs.

\set ON_ERROR_STOP on

TRUNCATE vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_export bigint;
    v_payload text;
    v_expires timestamptz;
    v_rows   integer;
    n        integer;
BEGIN
    -- Create: returns an id and the queue now carries a pending item.
    v_export := vc.create_export_request(1);
    IF v_export <= 0 THEN
        RAISE EXCEPTION 'create_export_request must return a positive id';
    END IF;
    SELECT count(*) INTO n FROM vc.list_pending_owner_ids();
    IF n <> 1 THEN
        RAISE EXCEPTION 'create_export_request must enqueue a pending work item (owners=%)', n;
    END IF;
    SELECT count(*) INTO n FROM vc.count_inflight_exports(1);
    IF n <> 1 THEN
        RAISE EXCEPTION 'count_inflight_exports must see the pending export (got %)', n;
    END IF;

    -- A second in-flight request RAISEs.
    BEGIN
        PERFORM vc.create_export_request(1);
        RAISE EXCEPTION 'second in-flight export unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%second in-flight export unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;

    -- Seal: PENDING -> READY with payload, token and expiry.
    v_rows := vc.complete_export(1, v_export, '{"exportId":"' || v_export || '"}',
                                 'tok-1', now() + interval '1 hour');
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'complete_export must seal exactly one row (got %)', v_rows;
    END IF;

    -- Status view: READY + token, and the payload is not exposed.
    DECLARE
        v_status text;
        v_token  text;
    BEGIN
        SELECT out_status, out_download_token INTO v_status, v_token
          FROM vc.get_export_request(1, v_export);
        IF v_status IS DISTINCT FROM 'READY' OR v_token IS DISTINCT FROM 'tok-1' THEN
            RAISE EXCEPTION 'get_export_request must report READY with the token (got %/%)',
                v_status, v_token;
        END IF;
    END;

    -- One-time consume: exactly one successful read.
    SELECT out_payload, out_expires_at INTO v_payload, v_expires
      FROM vc.consume_export(1, v_export, 'tok-1');
    IF v_payload IS NULL OR v_payload <> '{"exportId":"' || v_export || '"}' OR v_expires IS NULL THEN
        RAISE EXCEPTION 'consume_export must return the payload once';
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_export, 'tok-1');
    IF n <> 0 THEN
        RAISE EXCEPTION 'consume_export must be one-time (second call returned %)', n;
    END IF;

    -- Wrong token never consumes.
    v_export := vc.create_export_request(1);
    PERFORM vc.complete_export(1, v_export, '{"x":1}', 'tok-2', now() + interval '1 hour');
    SELECT count(*) INTO n FROM vc.consume_export(1, v_export, 'tok-wrong');
    IF n <> 0 THEN
        RAISE EXCEPTION 'wrong download token must not consume';
    END IF;
    SELECT count(*) INTO n FROM vc.consume_export(1, v_export, 'tok-2');
    IF n <> 1 THEN
        RAISE EXCEPTION 'correct token must consume after a wrong attempt';
    END IF;

    -- A foreign owner id RAISEs (trusted-owner assertion).
    BEGIN
        PERFORM * FROM vc.get_export_request(2, v_export);
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

-- Expiry sweep (superuser block: cross-owner maintenance + direct reads).
BEGIN;
-- Backdate a READY export directly so the sweep has work to do.
INSERT INTO vc.export_request(owner_user_id, id, status, requested_at, completed_at,
                              expires_at, download_token, payload)
VALUES (1, 9001, 'READY', now() - interval '2 hours', now() - interval '2 hours',
        now() - interval '1 hour', 'stale-tok', '{"stale":true}'),
       (1, 9002, 'READY', now() - interval '2 hours', now() - interval '2 hours',
        now() + interval '1 hour', 'live-tok', '{"live":true}');
DO $$
DECLARE
    v_rows integer;
    v_status text;
    v_payload text;
BEGIN
    SELECT vc.expire_stale_exports() INTO v_rows;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'expire_stale_exports must expire exactly the stale row (got %)', v_rows;
    END IF;
    SELECT status, payload INTO v_status, v_payload
      FROM vc.export_request WHERE owner_user_id = 1 AND id = 9001;
    IF v_status IS DISTINCT FROM 'EXPIRED' OR v_payload IS NOT NULL THEN
        RAISE EXCEPTION 'stale export must be EXPIRED with payload purged (got %/%)', v_status, v_payload;
    END IF;
    SELECT status INTO v_status FROM vc.export_request WHERE owner_user_id = 1 AND id = 9002;
    IF v_status IS DISTINCT FROM 'READY' THEN
        RAISE EXCEPTION 'live export must stay READY (got %)', v_status;
    END IF;
END $$;
COMMIT;

-- A non-vc_api role must NOT be able to call the functions.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.create_export_request(1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed create_export_request';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;

-- Create without a server-trusted owner context RAISEs (fail closed).
BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM * FROM vc.create_export_request(1);
    RAISE EXCEPTION 'create_export_request without owner context unexpectedly succeeded';
EXCEPTION
    WHEN OTHERS THEN
        NULL; -- expected: current_owner_id() is NULL, assertion fails closed
END $$;
COMMIT;
RESET ROLE;
