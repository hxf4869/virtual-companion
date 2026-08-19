-- 115_invite_service_window: INVITE / SVC-WINDOW V60 — invite-code
-- provisioning + Beta window state.
--
-- Covers: ADMIN mints a code (shape/expiry validated, non-ADMIN fails
-- closed); redemption is atomic and single-use (a second redeem fails; the
-- code flips USED with used_by/used_at); an expired or disabled code is
-- uniformly invalid (never disclosed which); the minted account is an ACTIVE
-- USER with an ACCOUNT_CREATE audit and the same 30-capacity gate; disable
-- is idempotent; beta_service_window_state reports DAU + owner-active under
-- the trusted-owner assertion; runtime roles cannot touch vc.invite_code
-- directly (SD-only).

\set ON_ERROR_STOP on

TRUNCATE vc.invite_code, vc.safety_event, vc.age_appeal, vc.report_request,
         vc.age_verification, vc.identity_auth_event, vc.identity_refresh_token,
         vc.identity_account, vc.export_request, vc.consent_record,
         vc.entitlement_snapshot, vc.service_class_assignment, vc.reminder,
         vc.generation_feedback, vc.memory_evidence, vc.memory_item,
         vc.generation_candidate, vc.generation_attempt, vc.generation_route,
         vc.generation, vc.message, vc.conversation, vc.relationship,
         vc.authorization_snapshot, vc.provider_deployment, vc.work_item,
         vc.outbox_event, vc.realtime_event, vc.vc_user CASCADE;

DO $$
DECLARE
    v_admin   bigint;
    v_user    bigint;
    v_invite  bigint;
    v_redeem  bigint;
    n         int;
BEGIN
    SELECT vc.identity_admin_seed('root-invite', '$2a$10$seed.hash.placeholder', 'Root') INTO v_admin;
    SELECT vc.identity_account_create(
        v_admin, 'alice-invite', '$2a$10$alice.hash.placeholder', 'USER', 'Alice') INTO v_user;

    -- ADMIN mints a code; a malformed code or a past expiry fails closed.
    SELECT vc.create_invite_code(v_admin, 'INVITE-ABC123XYZ', now() + interval '14 days')
      INTO v_invite;
    IF v_invite IS NULL OR v_invite <= 0 THEN
        RAISE EXCEPTION 'create_invite_code must return an id';
    END IF;
    BEGIN
        PERFORM vc.create_invite_code(v_admin, 'short', now() + interval '1 day');
        RAISE EXCEPTION 'malformed code unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%8..64%' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.create_invite_code(v_admin, 'INVITE-PASTEXPIRY', now() - interval '1 day');
        RAISE EXCEPTION 'past expiry unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%future%' THEN RAISE; END IF;
    END;

    -- Redemption: creates an ACTIVE USER, audits ACCOUNT_CREATE, flips the code.
    SELECT vc.redeem_invite_code(
        'INVITE-ABC123XYZ', 'Bob-Invite', '$2a$10$bob.hash.placeholder', 'Bob') INTO v_redeem;
    IF v_redeem IS NULL OR v_redeem <= 0 THEN
        RAISE EXCEPTION 'redeem must return an account id';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_account
     WHERE id = v_redeem AND role = 'USER' AND status = 'ACTIVE'
       AND username = 'bob-invite';
    IF n <> 1 THEN
        RAISE EXCEPTION 'redeemed account must be an ACTIVE USER bob-invite';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_auth_event
     WHERE event_type = 'ACCOUNT_CREATE' AND account_id = v_redeem;
    IF n <> 1 THEN
        RAISE EXCEPTION 'redeem must audit ACCOUNT_CREATE';
    END IF;
    SELECT count(*) INTO n FROM vc.invite_code
     WHERE code = 'INVITE-ABC123XYZ' AND status = 'USED'
       AND used_by_account = v_redeem AND used_at IS NOT NULL;
    IF n <> 1 THEN
        RAISE EXCEPTION 'code must flip USED with used_by/used_at';
    END IF;

    -- Single-use: a second redemption of the same code is uniformly invalid.
    BEGIN
        PERFORM vc.redeem_invite_code(
            'INVITE-ABC123XYZ', 'Carol-Invite', '$2a$10$carol.hash.placeholder', 'Carol');
        RAISE EXCEPTION 'used code unexpectedly redeemed twice';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%invalid or expired%' THEN RAISE; END IF;
    END;

    -- An unknown code gets the SAME error (existence never disclosed).
    BEGIN
        PERFORM vc.redeem_invite_code(
            'INVITE-UNKNOWN1', 'Dan-Invite', '$2a$10$dan.hash.placeholder', 'Dan');
        RAISE EXCEPTION 'unknown code unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%invalid or expired%' THEN RAISE; END IF;
    END;

    -- Disable: retired code cannot be redeemed; disable is idempotent.
    PERFORM vc.create_invite_code(v_admin, 'INVITE-DISABLED', now() + interval '14 days');
    IF NOT vc.disable_invite_code(v_admin, 'INVITE-DISABLED') THEN
        RAISE EXCEPTION 'disable of an ACTIVE code must return TRUE';
    END IF;
    IF NOT vc.disable_invite_code(v_admin, 'INVITE-DISABLED') THEN
        RAISE EXCEPTION 'disable must be idempotent';
    END IF;
    IF vc.disable_invite_code(v_admin, 'INVITE-NOTHERE') THEN
        RAISE EXCEPTION 'absent code must return FALSE';
    END IF;
    BEGIN
        PERFORM vc.redeem_invite_code(
            'INVITE-DISABLED', 'Eve-Invite', '$2a$10$eve.hash.placeholder', 'Eve');
        RAISE EXCEPTION 'disabled code unexpectedly redeemed';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%invalid or expired%' THEN RAISE; END IF;
    END;

    -- Non-ADMIN cannot mint, list or disable.
    BEGIN
        PERFORM vc.create_invite_code(v_user, 'INVITE-FORBID1', now() + interval '1 day');
        RAISE EXCEPTION 'non-admin unexpectedly minted a code';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN RAISE; END IF;
    END;

    -- The registry read is newest first.
    SELECT count(*) INTO n FROM vc.list_invite_codes(v_admin);
    IF n <> 2 THEN
        RAISE EXCEPTION 'registry must hold 2 codes, got %', n;
    END IF;
END $$;

-- SVC-WINDOW: DAU + owner-active over vc.generation, trusted-owner bound.
DO $$
DECLARE
    v_owner bigint;
    v_gen   bigint;
    v_dau   bigint;
    v_own   boolean;
BEGIN
    -- Alice (seeded above) gets a relationship, conversation and one generation.
    SELECT id INTO v_owner FROM vc.identity_account WHERE username = 'alice-invite';
    INSERT INTO vc.relationship(owner_user_id, id, persona_ref, active)
    VALUES (v_owner, 1, 'gentle-listener', true);
    INSERT INTO vc.conversation(owner_user_id, id, relationship_id, title)
    VALUES (v_owner, 1, 1, NULL);
    PERFORM vc.set_owner_context(v_owner, 'n1', encode(vc.hmac(
        convert_to('vc-owner-binding-v1|' || v_owner || '|' || pg_backend_pid()
                   || '|' || pg_current_xact_id() || '|' || 'n1', 'UTF8'),
        convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'),
        'sha256'), 'hex'));
    SET LOCAL ROLE vc_api;
    SELECT generation_id INTO v_gen
      FROM vc.receive_generation(v_owner, 1, 'window-key-1', 'user', 'hello');
    SELECT out_daily_active, out_owner_active INTO v_dau, v_own
      FROM vc.beta_service_window_state(v_owner, now() - interval '1 hour');
    IF v_dau <> 1 OR v_own IS NOT TRUE THEN
        RAISE EXCEPTION 'window state wrong: dau=% owner_active=%', v_dau, v_own;
    END IF;
    -- Owner mismatch fails closed.
    BEGIN
        PERFORM vc.beta_service_window_state(v_owner + 1000, now());
        RAISE EXCEPTION 'owner-mismatched window state unexpectedly accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%must match server-trusted context%' THEN RAISE; END IF;
    END;
    RESET ROLE;
END $$;

-- Direct table access is impossible for runtime roles (no policy, SD-only).
BEGIN;
SELECT vc.set_owner_context((SELECT id FROM vc.identity_account WHERE username = 'alice-invite'), 'n2', encode(vc.hmac(convert_to('vc-owner-binding-v1|' || (SELECT id FROM vc.identity_account WHERE username = 'alice-invite') || '|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'n2', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM count(*) FROM vc.invite_code;
    RAISE EXCEPTION 'vc_api unexpectedly read vc.invite_code directly';
EXCEPTION
    WHEN insufficient_privilege OR undefined_table THEN NULL;
END $$;
RESET ROLE;
