-- 120_emergency_contact: EMERGENCY-CONTACT V65 — the §20.14 lifecycle.
--
-- Covers: saving requires the standing EMERGENCY_CONTACT consent (fail
-- closed); an unverified contact is only a DRAFT; the one-time invite token
-- (wrong token fails closed, invite older than 7 days expires); confirmation
-- binds when/how/version and a 180-day validity; changing the contact
-- demotes back to DRAFT; an expired verification lazily demotes to DRAFT on
-- read; revoke is terminal and a fresh contact starts on a new row; every
-- read of a stored row appends an EMERGENCY_CONTACT_VIEW audit row;
-- cross-owner trusted-owner assertion; vc_worker cannot execute.

\set ON_ERROR_STOP on

TRUNCATE vc.emergency_contact, vc.consent_record, vc.conversation_summary,
         vc.memory_embedding, vc.trial_grant, vc.entitlement_snapshot,
         vc.service_class_assignment, vc.quota_ledger_entry, vc.invite_code,
         vc.safety_event, vc.age_appeal, vc.report_request, vc.age_verification,
         vc.identity_auth_event, vc.identity_refresh_token, vc.identity_account,
         vc.export_request, vc.reminder, vc.generation_feedback,
         vc.memory_evidence, vc.memory_item, vc.generation_candidate,
         vc.generation_attempt, vc.generation_route, vc.generation, vc.message,
         vc.conversation, vc.relationship, vc.authorization_snapshot,
         vc.provider_deployment, vc.work_item, vc.outbox_event,
         vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin bigint;
    v_alice bigint;
    v_bob   bigint;
BEGIN
    SELECT vc.identity_admin_seed('root-emc', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-emc', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_alice;
    SELECT vc.identity_account_create(
        v_admin, 'bob-emc', '$2a$10$bob.hash.placeholder', 'USER', 'Bob') INTO v_bob;

    -- The standing separate consent (FR-AUTH-003 / §20.14 step 1), alice only.
    INSERT INTO vc.consent_record(owner_user_id, id, consent_type, version, granted)
    VALUES (v_alice, 9501, 'EMERGENCY_CONTACT', '2026-08', true);

    CREATE TEMP TABLE emc_owner(a bigint, b bigint) ON COMMIT PRESERVE ROWS;
    DELETE FROM emc_owner;
    INSERT INTO emc_owner VALUES (v_alice, v_bob);
END $$;

-- ---------------------------------------------------------------------------
-- Alice: save → draft → invite → wrong token → confirm → verified → change
-- demotes → fresh invite.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('emc.a', (SELECT a::text FROM emc_owner), true),
       set_config('emc.b', (SELECT b::text FROM emc_owner), true);
SELECT vc.set_owner_context(current_setting('emc.a')::bigint, 'n1', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('emc.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint := current_setting('emc.a')::bigint;
    v_id    bigint;
    v_status text;
    v_token text;
    n       int;
BEGIN
    -- Save: draft only (未验证前只能保存为草稿).
    PERFORM vc.upsert_emergency_contact(v_alice, '妈妈', 'cipher-v1');
    SELECT out_id, out_status INTO v_id, v_status
      FROM vc.get_emergency_contact(v_alice) LIMIT 1;
    IF v_id IS NULL OR v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'saved contact must be a DRAFT';
    END IF;
    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_alice) g
     WHERE g.out_status = 'DRAFT' AND g.out_verified_at IS NULL
       AND g.out_invited_at IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'saved contact must be a DRAFT without invite'; END IF;

    -- Wrong token fails closed (existence of the row never disclosed).
    BEGIN
        PERFORM vc.confirm_emergency_contact_verification(v_alice, 'deadbeef', 'SIMULATED_EMAIL_LINK', '2026-08');
        RAISE EXCEPTION 'wrong token unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%wrong token unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%verification token mismatch%' THEN RAISE; END IF;
    END;

    -- Invite + confirm: binds when/how/version + 180-day validity.
    SELECT out_token INTO v_token FROM vc.start_emergency_contact_verification(v_alice);
    IF v_token IS NULL OR length(v_token) < 32 THEN
        RAISE EXCEPTION 'invite token must be a 32-hex token';
    END IF;
    PERFORM vc.confirm_emergency_contact_verification(v_alice, v_token, 'SIMULATED_EMAIL_LINK', '2026-08');
    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_alice) g
     WHERE g.out_status = 'VERIFIED' AND g.out_verified_at IS NOT NULL
       AND g.out_verified_method = 'SIMULATED_EMAIL_LINK'
       AND g.out_verified_expires_at > now()
       AND g.out_consent_version = '2026-08';
    IF n <> 1 THEN RAISE EXCEPTION 'confirmed contact must be VERIFIED with when/how/version'; END IF;

    -- Re-invite of a verified contact is refused.
    BEGIN
        PERFORM vc.start_emergency_contact_verification(v_alice);
        RAISE EXCEPTION 'verified contact unexpectedly re-invited';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%verified contact unexpectedly re-invited%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%only a draft contact can be verified%' THEN RAISE; END IF;
    END;

    -- 联系方式变更后重新确认: change demotes back to DRAFT.
    PERFORM vc.upsert_emergency_contact(v_alice, '妈妈', 'cipher-v2');
    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_alice) g
     WHERE g.out_status = 'DRAFT' AND g.out_verified_at IS NULL
       AND g.out_consent_version IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'changed contact must demote to DRAFT'; END IF;
END $$;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Stale invite (>7 days) fails closed, then a fresh invite re-verifies. The
-- backdating runs inside the SAME transaction: the DO flips between the
-- privileged session role (backdate) and vc_api (SD calls) — the owner GUC
-- context stays bound for the whole transaction.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('emc.a', (SELECT a::text FROM emc_owner), true);
SELECT vc.set_owner_context(current_setting('emc.a')::bigint, 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('emc.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
DO $$
DECLARE
    v_alice bigint := current_setting('emc.a')::bigint;
    v_token text;
    n       int;
BEGIN
    SET LOCAL ROLE vc_api;
    SELECT out_token INTO v_token FROM vc.start_emergency_contact_verification(v_alice);

    RESET ROLE;
    UPDATE vc.emergency_contact
       SET invited_at = now() - interval '8 days'
     WHERE owner_user_id = v_alice AND status = 'DRAFT';
    SET LOCAL ROLE vc_api;

    BEGIN
        PERFORM vc.confirm_emergency_contact_verification(v_alice, v_token, 'SIMULATED_EMAIL_LINK', '2026-08');
        RAISE EXCEPTION 'stale invite unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale invite unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%verification invite expired%' THEN RAISE; END IF;
    END;

    -- Re-verify to reach VERIFIED for the expiry-demotion section below.
    SELECT out_token INTO v_token FROM vc.start_emergency_contact_verification(v_alice);
    PERFORM vc.confirm_emergency_contact_verification(v_alice, v_token, 'SIMULATED_EMAIL_LINK', '2026-08');
    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_alice) g
     WHERE g.out_status = 'VERIFIED';
    IF n <> 1 THEN RAISE EXCEPTION 're-verification must reach VERIFIED'; END IF;
END $$;
RESET ROLE;

-- Backdate the verification validity (privileged), then read: lazy demotion.
DO $$
BEGIN
    UPDATE vc.emergency_contact
       SET verified_expires_at = now() - interval '1 day'
     WHERE owner_user_id = (SELECT a FROM emc_owner) AND status = 'VERIFIED';
END $$;

BEGIN;
SELECT set_config('emc.a', (SELECT a::text FROM emc_owner), true);
SELECT vc.set_owner_context(current_setting('emc.a')::bigint, 'n3', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('emc.a') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n3', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_alice bigint := current_setting('emc.a')::bigint;
    v_first bigint;
    v_new   bigint;
    n       int;
BEGIN
    -- 验证过期后重新确认: the read lazily demotes the expired verification.
    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_alice) g
     WHERE g.out_status = 'DRAFT' AND g.out_verified_at IS NULL
       AND g.out_verified_expires_at IS NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'expired verification must lazily demote to DRAFT'; END IF;

    SELECT out_id INTO v_first FROM vc.get_emergency_contact(v_alice);

    -- Revoke is terminal; a fresh contact starts on a NEW row.
    IF NOT vc.revoke_emergency_contact(v_alice) THEN
        RAISE EXCEPTION 'revoke must find the live contact';
    END IF;
    IF vc.revoke_emergency_contact(v_alice) THEN
        RAISE EXCEPTION 'second revoke must find nothing';
    END IF;
    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_alice);
    IF n <> 0 THEN RAISE EXCEPTION 'revoked contact must not surface'; END IF;

    PERFORM vc.upsert_emergency_contact(v_alice, '爸爸', 'cipher-v3');
    SELECT out_id INTO v_new FROM vc.get_emergency_contact(v_alice);
    IF v_new = v_first THEN
        RAISE EXCEPTION 'a revoked contact must not be reused';
    END IF;
END $$;
RESET ROLE;

-- Audit: every read of a stored row appended EMERGENCY_CONTACT_VIEW rows.
DO $$
DECLARE n int;
BEGIN
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'EMERGENCY_CONTACT_VIEW'
       AND account_id = (SELECT a FROM emc_owner);
    IF n < 2 THEN
        RAISE EXCEPTION 'each read of a stored row must be audited, got %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'EMERGENCY_CONTACT_VIEW'
       AND account_id = (SELECT b FROM emc_owner);
    IF n <> 0 THEN
        RAISE EXCEPTION 'no audit rows may exist for a contact never read';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Bob: no consent (fail closed); nothing saved; cross-owner call fails the
-- trusted-owner assertion.
-- ---------------------------------------------------------------------------
BEGIN;
SELECT set_config('emc.a', (SELECT a::text FROM emc_owner), true),
       set_config('emc.b', (SELECT b::text FROM emc_owner), true);
SELECT vc.set_owner_context(current_setting('emc.b')::bigint, 'n4', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || current_setting('emc.b') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n4', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    v_bob bigint := current_setting('emc.b')::bigint;
    n     int;
BEGIN
    BEGIN
        PERFORM vc.upsert_emergency_contact(v_bob, '朋友', 'cipher-bob');
        RAISE EXCEPTION 'save without the separate consent unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%save without the separate consent unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%EMERGENCY_CONTACT consent must be granted%' THEN RAISE; END IF;
    END;

    SELECT count(*) INTO n FROM vc.get_emergency_contact(v_bob);
    IF n <> 0 THEN RAISE EXCEPTION 'bob must have no contact'; END IF;

    BEGIN
        PERFORM vc.upsert_emergency_contact(
            current_setting('emc.a')::bigint, 'x', 'cipher-x');
        RAISE EXCEPTION 'owner-mismatched write unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%owner-mismatched write unexpectedly accepted%' THEN
            RAISE;
        END IF;
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN RAISE; END IF;
    END;
END $$;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'n5', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n5', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.upsert_emergency_contact(1, 'x', 'cipher-x');
    RAISE EXCEPTION 'vc_worker unexpectedly executed upsert_emergency_contact';
EXCEPTION
    WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
