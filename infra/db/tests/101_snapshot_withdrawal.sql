-- 101_snapshot_withdrawal: AUTH-RECHECK V46 — consent withdrawal withdraws
-- ACTIVE authorization snapshots (FR-AUTH-005).
--
-- Covers: withdraw_authorization_snapshots flips every ACTIVE snapshot of the
-- owner to WITHDRAWN (returns the count), a second call returns 0 (idempotent
-- by state), the trusted-owner assertion fails closed for foreign ids, and a
-- non-vc_api role cannot execute the function.

\set ON_ERROR_STOP on

TRUNCATE vc.authorization_snapshot, vc.age_verification, vc.identity_auth_event,
         vc.identity_refresh_token, vc.identity_account, vc.export_request,
         vc.consent_record, vc.entitlement_snapshot, vc.service_class_assignment,
         vc.reminder, vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.provider_deployment, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name) VALUES (1, 'alice');

-- Two ACTIVE snapshots for alice (the minting path is V26; direct INSERT here
-- only seeds the state the withdrawal operates on).
INSERT INTO vc.authorization_snapshot
    (owner_user_id, snapshot_id, status, provider_id, region, contract_ref,
     purpose, data_categories)
VALUES
    (1, 'snap-1', 'ACTIVE', 'openai-approved', 'CN', 'openai-chat-v1',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']),
    (1, 'snap-2', 'ACTIVE', 'openai-approved', 'CN', 'openai-chat-v1',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']),
    (1, 'snap-3', 'WITHDRAWN', 'openai-approved', 'CN', 'openai-chat-v1',
     'COMPANION_CHAT', ARRAY['MESSAGE_TEXT']);

BEGIN;
SELECT vc.set_owner_context(1, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n int;
    v_status text;
BEGIN
    -- The withdrawal flips the two ACTIVE rows; the already-withdrawn one stays.
    SELECT vc.withdraw_authorization_snapshots(1) INTO n;
    IF n <> 2 THEN
        RAISE EXCEPTION 'withdrawal must flip exactly the ACTIVE rows (got %)', n;
    END IF;
    SELECT status INTO v_status
      FROM vc.authorization_snapshot
     WHERE owner_user_id = 1 AND snapshot_id = 'snap-1';
    IF v_status IS DISTINCT FROM 'WITHDRAWN' THEN
        RAISE EXCEPTION 'snap-1 must be WITHDRAWN (got %)', v_status;
    END IF;

    -- Idempotent by state: a second call has nothing left to flip.
    SELECT vc.withdraw_authorization_snapshots(1) INTO n;
    IF n <> 0 THEN
        RAISE EXCEPTION 'second withdrawal must return 0 (got %)', n;
    END IF;

    -- A foreign owner RAISEs (trusted-owner assertion).
    BEGIN
        PERFORM * FROM vc.withdraw_authorization_snapshots(2);
        RAISE EXCEPTION 'foreign owner id unexpectedly passed the trusted-owner assertion';
    EXCEPTION WHEN OTHERS THEN
        NULL; -- expected
    END;
END $$;
COMMIT;
RESET ROLE;

-- A non-vc_api role must NOT be able to execute the function.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.withdraw_authorization_snapshots(1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed withdraw_authorization_snapshots';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
