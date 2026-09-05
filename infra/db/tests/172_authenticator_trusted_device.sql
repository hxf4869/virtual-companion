-- Product authentication: enrollment is atomic, recovery codes are one-time,
-- trusted-device expiry is fixed, owner isolation holds, and security resets
-- revoke every bypass credential.

\set ON_ERROR_STOP on

TRUNCATE vc.identity_account, vc.relationship, vc.vc_user CASCADE;

INSERT INTO vc.vc_user(id, display_name)
VALUES (1, 'alice'), (2, 'bob'), (3, 'pending'), (9, 'admin');
INSERT INTO vc.identity_account(
    id, username, email, email_verified_at, reviewed_at,
    password_hash, role, status, display_name)
VALUES
    (1, 'alice', 'alice@example.com', now(), now(), '$2a$10$alice.hash.placeholder', 'USER', 'ACTIVE', 'alice'),
    (2, 'bob', 'bob@example.com', now(), now(), '$2a$10$bob.hash.placeholder', 'USER', 'ACTIVE', 'bob'),
    (3, 'pending', 'pending@example.com', now(), NULL, '$2a$10$pending.hash.placeholder', 'USER', 'PENDING_REVIEW', 'pending'),
    (9, 'admin', 'admin@example.com', now(), now(), '$2a$10$admin.hash.placeholder', 'ADMIN', 'ACTIVE', 'admin');

BEGIN;
SELECT vc.set_owner_context(1, 'auth-enroll', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'auth-enroll', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    challenge_id text := repeat('A', 43);
    recovery_hashes text[] := ARRAY(
        SELECT lpad(to_hex(i), 64, '0') FROM generate_series(1, 10) i);
    created boolean;
    account_name text;
    pending_cipher text;
    locked_account bigint;
    session_id bigint;
    device_id bigint;
    listed_count integer;
BEGIN
    created := vc.identity_auth_challenge_create_current(
        challenge_id, 'TOTP_ENROLL', now() + interval '5 minutes');
    IF NOT created THEN
        RAISE EXCEPTION 'enrollment challenge was not created';
    END IF;
    SELECT out_account_name, out_pending_ciphertext
      INTO account_name, pending_cipher
      FROM vc.identity_auth_challenge_setup(challenge_id, 'enc2:test:1:cipher', now());
    IF account_name <> 'alice@example.com' OR pending_cipher <> 'enc2:test:1:cipher' THEN
        RAISE EXCEPTION 'setup mismatch: %, %', account_name, pending_cipher;
    END IF;
    SELECT out_account_id INTO locked_account
      FROM vc.identity_auth_challenge_lock(challenge_id, 'TOTP_ENROLL', now());
    IF locked_account <> 1 THEN
        RAISE EXCEPTION 'challenge was not owner locked';
    END IF;
    SELECT out_session_id, out_trusted_device_id
      INTO session_id, device_id
      FROM vc.identity_auth_challenge_complete_current(
          challenge_id, 'TOTP_ENROLL', repeat('1', 64), now() + interval '7 days',
          NULL, recovery_hashes, repeat('2', 64), 'Alice Mac',
          now() + interval '90 days', now());
    IF session_id IS NULL OR device_id IS NULL THEN
        RAISE EXCEPTION 'enrollment did not issue credentials';
    END IF;
    SELECT count(*) INTO listed_count FROM vc.identity_trusted_device_list_current();
    IF listed_count <> 1 THEN
        RAISE EXCEPTION 'trusted device list count %', listed_count;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(9, 'auth-admin-review', encode(vc.hmac(convert_to('vc-owner-binding-v1|9|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'auth-admin-review', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n integer;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = 1 AND totp_secret_ciphertext = 'enc2:test:1:cipher'
           AND totp_enabled_at IS NOT NULL) THEN
        RAISE EXCEPTION 'authenticator was not enabled';
    END IF;
    SELECT count(*) INTO n FROM vc.identity_mfa_recovery_code
     WHERE account_id = 1 AND used_at IS NULL;
    IF n <> 10 THEN
        RAISE EXCEPTION 'recovery code count %', n;
    END IF;
    SELECT count(*) INTO n FROM vc.relationship WHERE owner_user_id = 1 AND active;
    IF n <> 1 THEN
        RAISE EXCEPTION 'default relationship count %', n;
    END IF;
END $$;

-- A different owner cannot see or revoke Alice's trusted device.
BEGIN;
SELECT vc.set_owner_context(2, 'auth-cross-owner', encode(vc.hmac(convert_to('vc-owner-binding-v1|2|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'auth-cross-owner', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    n integer;
BEGIN
    SELECT count(*) INTO n FROM vc.identity_trusted_device_list_current();
    IF n <> 0 OR vc.identity_trusted_device_revoke_current(1) THEN
        RAISE EXCEPTION 'cross-owner trusted-device access succeeded';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(1, 'auth-recovery', encode(vc.hmac(convert_to('vc-owner-binding-v1|1|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'auth-recovery', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE
    trusted_expiry timestamptz;
    trusted_expiry_after timestamptz;
    recovery_id bigint;
    session_id bigint;
    device_id bigint;
    revoked_sessions integer;
BEGIN
    SELECT out_expires_at INTO trusted_expiry
      FROM vc.identity_trusted_device_list_current();
    SELECT out_session_id, out_trusted_device_id INTO session_id, device_id
      FROM vc.identity_trusted_device_login_current(
          repeat('2', 64), repeat('3', 64), now() + interval '7 days', now());
    IF session_id IS NULL OR device_id IS NULL THEN
        RAISE EXCEPTION 'trusted-device login failed';
    END IF;
    SELECT out_expires_at INTO trusted_expiry_after
      FROM vc.identity_trusted_device_list_current();
    IF trusted_expiry_after IS DISTINCT FROM trusted_expiry THEN
        RAISE EXCEPTION 'trusted-device expiry was extended';
    END IF;

    IF NOT vc.identity_auth_challenge_create_current(
        repeat('B', 43), 'TOTP_VERIFY', now() + interval '5 minutes') THEN
        RAISE EXCEPTION 'verification challenge was not created';
    END IF;
    recovery_id := vc.identity_auth_recovery_code_lock_current(lpad(to_hex(1), 64, '0'));
    IF recovery_id IS NULL THEN
        RAISE EXCEPTION 'recovery code was not found';
    END IF;
    PERFORM * FROM vc.identity_auth_challenge_complete_current(
        repeat('B', 43), 'TOTP_VERIFY', repeat('4', 64), now() + interval '7 days',
        recovery_id, NULL, NULL, NULL, NULL, now());
    IF vc.identity_auth_recovery_code_lock_current(lpad(to_hex(1), 64, '0')) IS NOT NULL THEN
        RAISE EXCEPTION 'recovery code was reusable';
    END IF;

    revoked_sessions := vc.identity_logout_all_current();
    IF revoked_sessions < 3 THEN
        RAISE EXCEPTION 'logout-all revoked only % sessions', revoked_sessions;
    END IF;
    IF EXISTS (SELECT 1 FROM vc.identity_trusted_device_list_current()) THEN
        RAISE EXCEPTION 'logout-all kept trusted devices';
    END IF;
END $$;
COMMIT;
RESET ROLE;

-- An administrator reset clears the factor and all associated recovery data.
BEGIN;
SELECT vc.set_owner_context(9, 'auth-admin-reset', encode(vc.hmac(convert_to('vc-owner-binding-v1|9|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|' || 'auth-admin-reset', 'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF NOT vc.identity_admin_reset_authenticator_current(1) THEN
        RAISE EXCEPTION 'admin authenticator reset failed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
DECLARE
    pending_count integer;
BEGIN
    SELECT count(*) INTO pending_count
      FROM vc.identity_admin_account_list_current()
     WHERE out_status = 'PENDING_REVIEW'
       AND out_email = 'pending@example.com'
       AND out_email_verified;
    IF pending_count <> 1 THEN
        RAISE EXCEPTION 'admin review list mismatch: %', pending_count;
    END IF;
    IF NOT vc.identity_admin_review_account_current(3, 'APPROVE', now()) THEN
        RAISE EXCEPTION 'admin review approval failed';
    END IF;
END $$;
COMMIT;
RESET ROLE;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = 3 AND status = 'ACTIVE' AND reviewed_by = 9
           AND reviewed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'approved account state mismatch';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = 1 AND (totp_secret_ciphertext IS NOT NULL OR totp_enabled_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'admin reset kept authenticator state';
    END IF;
    IF EXISTS (SELECT 1 FROM vc.identity_mfa_recovery_code WHERE account_id = 1) THEN
        RAISE EXCEPTION 'admin reset kept recovery codes';
    END IF;
    IF has_function_privilege('public',
            'vc.identity_auth_challenge_complete_current(text,text,text,timestamptz,bigint,text[],text,text,timestamptz,timestamptz)',
            'EXECUTE') THEN
        RAISE EXCEPTION 'PUBLIC unexpectedly executes auth completion';
    END IF;
END $$;
