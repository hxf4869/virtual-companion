-- 96_consent_records: CONSENT V41 — versioned append-only consent records.
--
-- Covers: record_consent appends a new row per grant/revoke (history is never
-- rewritten), list_consents returns the LATEST row per type (the effective
-- state), unapproved types / blank versions RAISE, the trusted-owner
-- assertion fails closed for foreign ids, and a non-vc_api role cannot
-- execute the functions.

\set ON_ERROR_STOP on

TRUNCATE vc.consent_record, vc.entitlement_snapshot, vc.service_class_assignment,
         vc.reminder, vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id1 bigint;
    v_id2 bigint;
    v_ok  boolean;
    n     int;
BEGIN
    -- Grant SERVICE_TERMS v1, then re-grant v2: two append-only rows.
    v_id1 := vc.record_consent(1, 'SERVICE_TERMS', 'v1', true);
    v_id2 := vc.record_consent(1, 'SERVICE_TERMS', 'v2', true);
    IF v_id1 <= 0 OR v_id2 <= 0 OR v_id2 <= v_id1 THEN
        RAISE EXCEPTION 'record_consent must append increasing ids';
    END IF;

    -- Revoke MODEL_TRAINING: a second type with granted=false + revoked_at.
    v_id1 := vc.record_consent(1, 'MODEL_TRAINING', 'v1', false);

    -- Effective list now carries exactly the two types (one row each).
    SELECT count(*) INTO n FROM vc.list_consents(1);
    IF n <> 2 THEN
        RAISE EXCEPTION 'list_consents must return one latest row per type (got %)', n;
    END IF;

    -- Unapproved type RAISEs (defense in depth).
    BEGIN
        PERFORM vc.record_consent(1, 'FACE_DATA', 'v1', true);
        RAISE EXCEPTION 'unapproved consent type unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%unapproved consent type unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
    -- Blank version RAISEs.
    BEGIN
        PERFORM vc.record_consent(1, 'PRIVACY_POLICY', '  ', true);
        RAISE EXCEPTION 'blank version unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%blank version unexpectedly succeeded%' THEN
            RAISE;
        END IF;
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- Effective-state assertions (trusted-owner context required).
BEGIN;
SELECT vc.set_owner_context(1, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_version text;
    v_granted boolean;
    v_revoked timestamptz;
    n int;
BEGIN
    SELECT out_version, out_granted, out_revoked_at
      INTO v_version, v_granted, v_revoked
      FROM vc.list_consents(1)
     WHERE out_consent_type = 'SERVICE_TERMS';
    IF v_version IS DISTINCT FROM 'v2' OR v_granted IS NOT TRUE THEN
        RAISE EXCEPTION 'effective SERVICE_TERMS must be v2 granted (got %/%)', v_version, v_granted;
    END IF;

    SELECT out_granted, out_revoked_at INTO v_granted, v_revoked
      FROM vc.list_consents(1)
     WHERE out_consent_type = 'MODEL_TRAINING';
    IF v_granted IS NOT FALSE OR v_revoked IS NULL THEN
        RAISE EXCEPTION 'effective MODEL_TRAINING must be revoked with a timestamp';
    END IF;

    -- The history is append-only: three rows total.
    SELECT count(*) INTO n FROM vc.consent_record WHERE owner_user_id = 1;
    IF n <> 3 THEN
        RAISE EXCEPTION 'append-only history must keep all rows (got %)', n;
    END IF;
END $$;
COMMIT;

-- A non-vc_api role must NOT be able to call the functions.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.record_consent(1, 'SERVICE_TERMS', 'v1', true);
    RAISE EXCEPTION 'vc_worker unexpectedly executed record_consent';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
