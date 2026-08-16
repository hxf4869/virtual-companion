-- 98_account_delete: ACCT-DELETE V43 — self-service account deletion.
--
-- Covers: identity_account_delete deletes the caller's own ACTIVE account,
-- cascades the vc_user root (identity account, refresh sessions and all
-- business rows: relationship/conversation/message/work_item/consent/export),
-- records the ACCOUNT_DELETE audit event before the deletion (the append-only
-- trail has no FK and survives), a second call reports FALSE (existence never
-- disclosed), a DISABLED account reports FALSE, identity_authenticate finds
-- no row afterwards (deletion tombstone blocks login recovery), and a
-- non-vc_api role cannot execute the function.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.consent_record, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
    v_ok    boolean;
    n       integer;
BEGIN
    SELECT vc.identity_admin_seed('root-admin-98', '$2a$10$seed.hash.placeholder', 'Root Admin')
      INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice98', '$2a$10$alice.hash.placeholder', 'USER', 'Alice')
      INTO v_alice;

    -- Business rows owned by alice (FK to vc.vc_user).
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_alice, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_alice, 1, 1, NULL);
    INSERT INTO vc.message(owner_user_id, id, conversation_id, role, content)
    VALUES (v_alice, 1, 1, 'user', '你好');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (v_alice, 1, 'GENERATION', 1, 'PENDING');
    INSERT INTO vc.consent_record(owner_user_id, id, consent_type, version, granted)
    VALUES (v_alice, 1, 'SERVICE_TERMS', '2026-08', true);
    INSERT INTO vc.export_request(owner_user_id, id, status)
    VALUES (v_alice, 1, 'PENDING');
    -- A refresh session for alice.
    INSERT INTO vc.identity_refresh_token(account_id, token_hash, expires_at)
    VALUES (v_alice, 'hash-alice98', now() + interval '1 day');

    -- Deletion tombstone: deletes the caller's own ACTIVE account.
    SELECT vc.identity_account_delete(v_alice) INTO v_ok;
    IF v_ok IS NOT TRUE THEN
        RAISE EXCEPTION 'identity_account_delete must report TRUE for an ACTIVE account';
    END IF;

    -- Identity row gone, refresh sessions gone, business rows gone.
    SELECT count(*) INTO n FROM vc.identity_account WHERE id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'identity_account row must be deleted (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.identity_refresh_token WHERE account_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'refresh sessions must be cascaded away (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'relationships must be cascaded away (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.conversation WHERE owner_user_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'conversations must be cascaded away (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.message WHERE owner_user_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'messages must be cascaded away (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.work_item WHERE owner_user_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'work items must be cascaded away (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.consent_record WHERE owner_user_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'consent records must be cascaded away (got %)', n; END IF;
    SELECT count(*) INTO n FROM vc.export_request WHERE owner_user_id = v_alice;
    IF n <> 0 THEN RAISE EXCEPTION 'export requests must be cascaded away (got %)', n; END IF;

    -- The append-only compliance audit trail keeps the ACCOUNT_DELETE event.
    SELECT count(*) INTO n
      FROM vc.identity_auth_event
     WHERE event_type = 'ACCOUNT_DELETE' AND account_id = v_alice;
    IF n <> 1 THEN
        RAISE EXCEPTION 'ACCOUNT_DELETE audit event must be recorded (got %)', n;
    END IF;

    -- Login recovery is impossible: identity_authenticate finds no row.
    SELECT count(*) INTO n FROM vc.identity_authenticate('alice98');
    IF n <> 0 THEN
        RAISE EXCEPTION 'login must find no row for a deleted username (got %)', n;
    END IF;

    -- A second call reports FALSE (existence never disclosed).
    SELECT vc.identity_account_delete(v_alice) INTO v_ok;
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'second deletion must report FALSE';
    END IF;

    -- A DISABLED account reports FALSE (not deleted).
    SELECT vc.identity_account_create(
        v_admin, 'bob98', '$2a$10$bob.hash.placeholder', 'USER', 'Bob')
      INTO v_bob;
    PERFORM vc.identity_account_disable(v_admin, v_bob);
    SELECT vc.identity_account_delete(v_bob) INTO v_ok;
    IF v_ok IS NOT FALSE THEN
        RAISE EXCEPTION 'deleting a DISABLED account must report FALSE';
    END IF;
END $$;

-- A non-vc_api role must NOT be able to delete accounts.
SET ROLE vc_worker;
BEGIN;
DO $$
BEGIN
    PERFORM * FROM vc.identity_account_delete(1);
    RAISE EXCEPTION 'vc_worker unexpectedly executed identity_account_delete';
EXCEPTION
    WHEN insufficient_privilege THEN
        NULL; -- expected: EXECUTE granted only to vc_api
END $$;
COMMIT;
RESET ROLE;
