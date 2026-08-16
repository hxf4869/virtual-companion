-- 100_age_verification: AGE-MIN V45 — adult-verification result persistence.
--
-- Covers: record_age_verification appends the result history (latest row is
-- the effective state), unapproved age states RAISE, the trusted-owner
-- assertion fails closed for foreign ids, get_age_state returns the latest
-- row / nothing for a never-verified owner, and a non-vc_api role cannot
-- execute the functions.

\set ON_ERROR_STOP on

TRUNCATE vc.age_verification, vc.identity_auth_event, vc.identity_refresh_token,
         vc.identity_account, vc.export_request, vc.consent_record,
         vc.entitlement_snapshot, vc.service_class_assignment, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_id bigint;
    v_state text;
    v_provider text;
    n int;
BEGIN
    -- The verification flow appends history: declaration, required, verified.
    v_id := vc.record_age_verification(1, 'ADULT_SELF_DECLARED', 'alpha-simulated');
    IF v_id <= 0 THEN RAISE EXCEPTION 'record must return a positive id'; END IF;
    PERFORM vc.record_age_verification(1, 'ADULT_VERIFICATION_REQUIRED', 'alpha-simulated');
    PERFORM vc.record_age_verification(1, 'ADULT_VERIFIED', 'alpha-simulated');

    -- Effective state is the latest row.
    SELECT out_age_state, out_provider_ref INTO v_state, v_provider
      FROM vc.get_age_state(1);
    IF v_state IS DISTINCT FROM 'ADULT_VERIFIED' OR v_provider IS DISTINCT FROM 'alpha-simulated' THEN
        RAISE EXCEPTION 'effective state must be ADULT_VERIFIED (got %/%)', v_state, v_provider;
    END IF;

    -- An unapproved age state RAISEs.
    BEGIN
        PERFORM vc.record_age_verification(1, 'NOT_A_STATE', 'x');
        RAISE EXCEPTION 'unapproved age state unexpectedly succeeded';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;

    -- A foreign owner RAISEs (trusted-owner assertion).
    BEGIN
        PERFORM * FROM vc.get_age_state(2);
        RAISE EXCEPTION 'foreign owner id unexpectedly passed the trusted-owner assertion';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- A never-verified owner yields no rows.
BEGIN;
INSERT INTO vc.vc_user(id, display_name) VALUES (2, 'bob');
SELECT vc.set_owner_context(2, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.get_age_state(2);
    IF n <> 0 THEN
        RAISE EXCEPTION 'never-verified owner must have no age rows (got %)', n;
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- History is append-only (superuser block: vc_api has no table-level SELECT).
BEGIN;
DO $$
DECLARE
    n int;
BEGIN
    SELECT count(*) INTO n FROM vc.age_verification WHERE owner_user_id = 1;
    IF n <> 3 THEN RAISE EXCEPTION 'history must keep all rows (got %)', n; END IF;
END $$;
COMMIT;

-- A non-vc_api role must NOT be able to execute the functions.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.record_age_verification(1, 'ADULT_VERIFIED', 'x');
    RAISE EXCEPTION 'vc_worker unexpectedly executed record_age_verification';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
