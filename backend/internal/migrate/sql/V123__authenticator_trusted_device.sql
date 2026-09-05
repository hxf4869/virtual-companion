-- Product authentication: account-level TOTP, one-time recovery codes, short
-- login challenges and an optional fixed 90-day trusted-device credential.
-- Public registration remains closed; the additional account states are the
-- durable contract for the later reviewed-registration flow.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.identity_account
    ADD COLUMN IF NOT EXISTS email text,
    ADD COLUMN IF NOT EXISTS email_verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
    ADD COLUMN IF NOT EXISTS reviewed_by bigint,
    ADD COLUMN IF NOT EXISTS totp_secret_ciphertext text,
    ADD COLUMN IF NOT EXISTS totp_enabled_at timestamptz;

ALTER TABLE vc.identity_account
    DROP CONSTRAINT IF EXISTS identity_account_status_check;
ALTER TABLE vc.identity_account
    ADD CONSTRAINT identity_account_status_check CHECK (status IN (
        'EMAIL_UNVERIFIED', 'PENDING_REVIEW', 'ACTIVE', 'DISABLED', 'REJECTED'));

ALTER TABLE vc.identity_account
    DROP CONSTRAINT IF EXISTS identity_account_email_check;
ALTER TABLE vc.identity_account
    ADD CONSTRAINT identity_account_email_check CHECK (
        email IS NULL OR (
            email = lower(btrim(email))
            AND char_length(email) BETWEEN 3 AND 320
            AND position('@' IN email) > 1));

ALTER TABLE vc.identity_account
    DROP CONSTRAINT IF EXISTS identity_account_totp_pair_check;
ALTER TABLE vc.identity_account
    ADD CONSTRAINT identity_account_totp_pair_check CHECK (
        (totp_secret_ciphertext IS NULL) = (totp_enabled_at IS NULL));

ALTER TABLE vc.identity_account
    DROP CONSTRAINT IF EXISTS identity_account_reviewed_by_fkey;
ALTER TABLE vc.identity_account
    ADD CONSTRAINT identity_account_reviewed_by_fkey
        FOREIGN KEY (reviewed_by) REFERENCES vc.identity_account(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS identity_account_email_unique
    ON vc.identity_account (email) WHERE email IS NOT NULL;

-- The public login endpoint accepts email only. Keeping username lookup here is
-- limited to server-side current-password verification for existing sessions.
CREATE OR REPLACE FUNCTION vc.identity_authenticate(p_username text)
    RETURNS TABLE(
        out_account_id bigint,
        out_role text,
        out_status text,
        out_password_hash text,
        out_password_must_change boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_identifier text := lower(btrim(p_username));
BEGIN
    IF p_username IS NULL OR v_identifier = '' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT a.id, a.role, a.status, a.password_hash, a.password_must_change
          FROM vc.identity_account a
         WHERE a.email = v_identifier OR a.username = v_identifier;
END;
$$;

-- The existing opaque-session contract names this column out_username. From
-- this migration onward it carries the account's user-facing login name:
-- email for product accounts, with username retained only for legacy/internal
-- accounts. The Go principal continues to use the same field for password
-- re-verification, and identity_authenticate accepts either value above.
CREATE OR REPLACE FUNCTION vc.identity_opaque_session_lookup(p_token_hash text)
    RETURNS TABLE(
        out_session_id bigint,
        out_account_id bigint,
        out_role text,
        out_username text,
        out_status text,
        out_password_must_change boolean,
        out_created_at timestamptz,
        out_expires_at timestamptz,
        out_reauth_at timestamptz
    )
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN;
    END IF;
    RETURN QUERY
        SELECT s.id, a.id, a.role, COALESCE(a.email, a.username), a.status,
               a.password_must_change, s.created_at, s.expires_at, s.reauth_at
          FROM vc.identity_opaque_session s
          JOIN vc.identity_account a ON a.id = s.account_id
         WHERE s.token_hash = p_token_hash
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
           AND a.status = 'ACTIVE';
END;
$$;

CREATE TABLE vc.identity_auth_challenge (
    id text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{43}$'),
    account_id bigint NOT NULL REFERENCES vc.identity_account(id) ON DELETE CASCADE,
    mode text NOT NULL CHECK (mode IN ('TOTP_VERIFY', 'TOTP_ENROLL')),
    pending_totp_secret_ciphertext text,
    failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX identity_auth_challenge_account_live_idx
    ON vc.identity_auth_challenge (account_id, expires_at DESC)
    WHERE consumed_at IS NULL;

CREATE TABLE vc.identity_mfa_recovery_code (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES vc.identity_account(id) ON DELETE CASCADE,
    code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, code_hash)
);

CREATE TABLE vc.identity_trusted_device (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    account_id bigint NOT NULL REFERENCES vc.identity_account(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    display_name text NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);

CREATE INDEX identity_trusted_device_account_live_idx
    ON vc.identity_trusted_device (account_id, last_used_at DESC)
    WHERE revoked_at IS NULL;

REVOKE ALL ON TABLE vc.identity_auth_challenge FROM PUBLIC;
REVOKE ALL ON TABLE vc.identity_mfa_recovery_code FROM PUBLIC;
REVOKE ALL ON TABLE vc.identity_trusted_device FROM PUBLIC;

CREATE FUNCTION vc.identity_authenticator_enabled_current()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT EXISTS (
        SELECT 1 FROM vc.identity_account a
         WHERE a.id = vc.current_owner_id()
           AND a.status = 'ACTIVE'
           AND a.totp_secret_ciphertext IS NOT NULL)
$$;

-- Called only after the password has been verified and the Go store has bound
-- the same server-trusted owner context on this transaction.
CREATE FUNCTION vc.identity_auth_challenge_create_current(
    p_id text,
    p_mode text,
    p_expires_at timestamptz
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_has_totp boolean;
BEGIN
    IF v_owner_id IS NULL OR p_id IS NULL OR p_id !~ '^[A-Za-z0-9_-]{43}$'
       OR p_mode NOT IN ('TOTP_VERIFY', 'TOTP_ENROLL')
       OR p_expires_at IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION 'identity_auth_challenge_create_current: invalid request';
    END IF;
    SELECT a.totp_secret_ciphertext IS NOT NULL INTO v_has_totp
      FROM vc.identity_account a
     WHERE a.id = v_owner_id AND a.status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    IF (p_mode = 'TOTP_VERIFY') IS DISTINCT FROM v_has_totp THEN
        RETURN FALSE;
    END IF;
    INSERT INTO vc.identity_auth_challenge(id, account_id, mode, expires_at)
    VALUES (p_id, v_owner_id, p_mode, p_expires_at);
    RETURN TRUE;
END;
$$;

-- First setup stores one encrypted pending secret. Repeating setup for the
-- same live challenge returns the already stored value instead of rotating it.
CREATE FUNCTION vc.identity_auth_challenge_setup(
    p_id text,
    p_new_pending_ciphertext text,
    p_now timestamptz
)
    RETURNS TABLE(out_account_name text, out_pending_ciphertext text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_new_pending_ciphertext IS NULL OR btrim(p_new_pending_ciphertext) = ''
       OR p_now IS NULL THEN
        RETURN;
    END IF;
    RETURN QUERY
    UPDATE vc.identity_auth_challenge c
       SET pending_totp_secret_ciphertext = COALESCE(
           c.pending_totp_secret_ciphertext, p_new_pending_ciphertext)
      FROM vc.identity_account a
     WHERE c.id = p_id
       AND c.account_id = a.id
       AND a.status = 'ACTIVE'
       AND c.mode = 'TOTP_ENROLL'
       AND c.consumed_at IS NULL
       AND c.expires_at > p_now
       AND c.failed_attempts < 5
    RETURNING COALESCE(a.email, a.username), c.pending_totp_secret_ciphertext;
END;
$$;

-- The caller keeps this transaction open while it decrypts and verifies the
-- presented TOTP or recovery code. The row lock makes challenge consumption
-- and one-time recovery-code use atomic.
CREATE FUNCTION vc.identity_auth_challenge_lock(
    p_id text,
    p_expected_mode text,
    p_now timestamptz
)
    RETURNS TABLE(
        out_account_id bigint,
        out_role text,
        out_account_name text,
        out_password_must_change boolean,
        out_current_totp_ciphertext text,
        out_pending_totp_ciphertext text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT a.id, a.role, COALESCE(a.email, a.username), a.password_must_change,
           a.totp_secret_ciphertext, c.pending_totp_secret_ciphertext
      FROM vc.identity_auth_challenge c
      JOIN vc.identity_account a ON a.id = c.account_id
     WHERE c.id = p_id
       AND c.mode = p_expected_mode
       AND c.consumed_at IS NULL
       AND c.expires_at > p_now
       AND c.failed_attempts < 5
       AND a.status = 'ACTIVE'
     FOR UPDATE OF c, a;
END;
$$;

CREATE FUNCTION vc.identity_auth_recovery_code_lock_current(p_code_hash text)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_owner_id bigint := vc.current_owner_id();
BEGIN
    IF v_owner_id IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$' THEN
        RETURN NULL;
    END IF;
    SELECT r.id INTO v_id
      FROM vc.identity_mfa_recovery_code r
     WHERE r.account_id = v_owner_id
       AND r.code_hash = p_code_hash
       AND r.used_at IS NULL
     FOR UPDATE;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.identity_auth_challenge_fail_current(p_id text, p_now timestamptz)
    RETURNS smallint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_attempts smallint;
    v_owner_id bigint := vc.current_owner_id();
BEGIN
    UPDATE vc.identity_auth_challenge c
       SET failed_attempts = LEAST(5, c.failed_attempts + 1),
           consumed_at = CASE WHEN c.failed_attempts + 1 >= 5 THEN p_now ELSE c.consumed_at END
     WHERE c.id = p_id
       AND c.account_id = v_owner_id
       AND c.consumed_at IS NULL
    RETURNING c.failed_attempts INTO v_attempts;
    RETURN v_attempts;
END;
$$;

CREATE FUNCTION vc.identity_auth_challenge_complete_current(
    p_id text,
    p_expected_mode text,
    p_session_hash text,
    p_session_expires_at timestamptz,
    p_recovery_code_id bigint,
    p_new_recovery_hashes text[],
    p_trusted_device_hash text,
    p_trusted_device_name text,
    p_trusted_device_expires_at timestamptz,
    p_now timestamptz
)
    RETURNS TABLE(out_session_id bigint, out_trusted_device_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_mode text;
    v_pending text;
    v_session_id bigint;
    v_device_id bigint;
BEGIN
    IF v_owner_id IS NULL OR p_expected_mode NOT IN ('TOTP_VERIFY', 'TOTP_ENROLL')
       OR p_session_hash !~ '^[0-9a-f]{64}$'
       OR p_session_expires_at IS NULL OR p_session_expires_at <= p_now THEN
        RAISE EXCEPTION 'identity_auth_challenge_complete_current: invalid request';
    END IF;
    SELECT c.mode, c.pending_totp_secret_ciphertext
      INTO v_mode, v_pending
      FROM vc.identity_auth_challenge c
      JOIN vc.identity_account a ON a.id = c.account_id
     WHERE c.id = p_id
       AND c.account_id = v_owner_id
       AND c.mode = p_expected_mode
       AND c.consumed_at IS NULL
       AND c.expires_at > p_now
       AND c.failed_attempts < 5
       AND a.status = 'ACTIVE'
     FOR UPDATE OF c, a;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'identity_auth_challenge_complete_current: challenge not found';
    END IF;

    IF p_recovery_code_id IS NOT NULL THEN
        UPDATE vc.identity_mfa_recovery_code
           SET used_at = p_now
         WHERE id = p_recovery_code_id
           AND account_id = v_owner_id
           AND used_at IS NULL;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: recovery code not found';
        END IF;
    END IF;

    IF v_mode = 'TOTP_ENROLL' THEN
        IF v_pending IS NULL OR cardinality(p_new_recovery_hashes) IS DISTINCT FROM 10
           OR EXISTS (
               SELECT 1 FROM unnest(p_new_recovery_hashes) h
                WHERE h !~ '^[0-9a-f]{64}$') THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: invalid enrollment';
        END IF;
        UPDATE vc.identity_account
           SET totp_secret_ciphertext = v_pending,
               totp_enabled_at = p_now
         WHERE id = v_owner_id;
        DELETE FROM vc.identity_mfa_recovery_code WHERE account_id = v_owner_id;
        INSERT INTO vc.identity_mfa_recovery_code(account_id, code_hash, created_at)
        SELECT v_owner_id, h, p_now FROM unnest(p_new_recovery_hashes) h;
    END IF;

    INSERT INTO vc.identity_opaque_session(account_id, token_hash, created_at, expires_at)
    VALUES (v_owner_id, p_session_hash, p_now, p_session_expires_at)
    RETURNING id INTO v_session_id;

    IF p_trusted_device_hash IS NOT NULL THEN
        IF p_trusted_device_hash !~ '^[0-9a-f]{64}$'
           OR char_length(btrim(p_trusted_device_name)) NOT BETWEEN 1 AND 120
           OR p_trusted_device_expires_at IS NULL
           OR p_trusted_device_expires_at <= p_now THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: invalid trusted device';
        END IF;
        INSERT INTO vc.identity_trusted_device(
            account_id, token_hash, display_name, created_at, last_used_at, expires_at)
        VALUES (
            v_owner_id, p_trusted_device_hash, btrim(p_trusted_device_name),
            p_now, p_now, p_trusted_device_expires_at)
        RETURNING id INTO v_device_id;
    END IF;

    UPDATE vc.identity_auth_challenge SET consumed_at = p_now WHERE id = p_id;
    IF v_mode = 'TOTP_ENROLL' THEN
        PERFORM 1 FROM vc.ensure_default_relationship(v_owner_id, 'gentle-listener');
    END IF;
    RETURN QUERY SELECT v_session_id, v_device_id;
END;
$$;

CREATE FUNCTION vc.identity_trusted_device_login_current(
    p_device_hash text,
    p_session_hash text,
    p_session_expires_at timestamptz,
    p_now timestamptz
)
    RETURNS TABLE(out_session_id bigint, out_trusted_device_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_device_id bigint;
    v_session_id bigint;
BEGIN
    IF v_owner_id IS NULL OR p_device_hash !~ '^[0-9a-f]{64}$'
       OR p_session_hash !~ '^[0-9a-f]{64}$'
       OR p_session_expires_at IS NULL OR p_session_expires_at <= p_now THEN
        RETURN;
    END IF;
    SELECT d.id INTO v_device_id
      FROM vc.identity_trusted_device d
      JOIN vc.identity_account a ON a.id = d.account_id
     WHERE d.account_id = v_owner_id
       AND d.token_hash = p_device_hash
       AND d.revoked_at IS NULL
       AND d.expires_at > p_now
       AND a.status = 'ACTIVE'
       AND a.totp_secret_ciphertext IS NOT NULL
     FOR UPDATE OF d, a;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    UPDATE vc.identity_trusted_device SET last_used_at = p_now WHERE id = v_device_id;
    INSERT INTO vc.identity_opaque_session(account_id, token_hash, created_at, expires_at)
    VALUES (v_owner_id, p_session_hash, p_now, p_session_expires_at)
    RETURNING id INTO v_session_id;
    RETURN QUERY SELECT v_session_id, v_device_id;
END;
$$;

CREATE FUNCTION vc.identity_trusted_device_list_current()
    RETURNS TABLE(
        out_id bigint,
        out_display_name text,
        out_created_at timestamptz,
        out_last_used_at timestamptz,
        out_expires_at timestamptz)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT d.id, d.display_name, d.created_at, d.last_used_at, d.expires_at
      FROM vc.identity_trusted_device d
     WHERE d.account_id = vc.current_owner_id()
       AND d.revoked_at IS NULL
       AND d.expires_at > now()
     ORDER BY d.last_used_at DESC, d.id DESC
$$;

CREATE FUNCTION vc.identity_trusted_device_revoke_current(p_device_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    UPDATE vc.identity_trusted_device
       SET revoked_at = now()
     WHERE id = p_device_id
       AND account_id = vc.current_owner_id()
       AND revoked_at IS NULL;
    RETURN FOUND;
END;
$$;

CREATE FUNCTION vc.identity_trusted_device_revoke_all_current()
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_count integer;
BEGIN
    UPDATE vc.identity_trusted_device
       SET revoked_at = now()
     WHERE account_id = vc.current_owner_id()
       AND revoked_at IS NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

CREATE FUNCTION vc.identity_logout_all_current()
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_sessions integer;
BEGIN
    v_sessions := vc.identity_opaque_session_revoke_all(v_owner_id);
    PERFORM vc.identity_trusted_device_revoke_all_current();
    RETURN v_sessions;
END;
$$;

CREATE FUNCTION vc.identity_admin_reset_authenticator_current(p_target_account_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = vc.current_owner_id() AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_admin_reset_authenticator_current: ADMIN required';
    END IF;
    UPDATE vc.identity_account
       SET totp_secret_ciphertext = NULL,
           totp_enabled_at = NULL
     WHERE id = p_target_account_id
       AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    DELETE FROM vc.identity_mfa_recovery_code WHERE account_id = p_target_account_id;
    UPDATE vc.identity_auth_challenge
       SET consumed_at = now()
     WHERE account_id = p_target_account_id AND consumed_at IS NULL;
    UPDATE vc.identity_opaque_session
       SET revoked_at = now()
     WHERE account_id = p_target_account_id AND revoked_at IS NULL;
    UPDATE vc.identity_trusted_device
       SET revoked_at = now()
     WHERE account_id = p_target_account_id AND revoked_at IS NULL;
    RETURN TRUE;
END;
$$;

-- Secret-free account facts for the two real admin consumers: the review
-- queue and account security management. The caller is supplied only through
-- the transaction-local owner context established by the Go store.
CREATE FUNCTION vc.identity_admin_account_list_current()
    RETURNS TABLE(
        out_account_id bigint,
        out_email text,
        out_username text,
        out_display_name text,
        out_role text,
        out_status text,
        out_email_verified boolean,
        out_authenticator_enabled boolean,
        out_created_at timestamptz,
        out_reviewed_at timestamptz)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = vc.current_owner_id() AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_admin_account_list_current: ADMIN required';
    END IF;
    RETURN QUERY
    SELECT a.id, a.email, a.username, a.display_name, a.role, a.status,
           a.email_verified_at IS NOT NULL,
           a.totp_secret_ciphertext IS NOT NULL,
           a.created_at, a.reviewed_at
      FROM vc.identity_account a
     ORDER BY a.created_at DESC, a.id DESC;
END;
$$;

CREATE FUNCTION vc.identity_admin_review_account_current(
    p_target_account_id bigint,
    p_decision text,
    p_now timestamptz
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_decision text := upper(btrim(p_decision));
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account
         WHERE id = v_owner_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_admin_review_account_current: ADMIN required';
    END IF;
    IF p_target_account_id IS NULL OR p_target_account_id <= 0
       OR v_decision NOT IN ('APPROVE', 'REJECT') OR p_now IS NULL THEN
        RAISE EXCEPTION 'identity_admin_review_account_current: invalid request';
    END IF;
    UPDATE vc.identity_account
       SET status = CASE WHEN v_decision = 'APPROVE' THEN 'ACTIVE' ELSE 'REJECTED' END,
           reviewed_at = p_now,
           reviewed_by = v_owner_id
     WHERE id = p_target_account_id
       AND status = 'PENDING_REVIEW'
       AND (v_decision = 'REJECT' OR email_verified_at IS NOT NULL);
    RETURN FOUND;
END;
$$;

-- Password changes and explicit "log out all" revoke trusted-device bypasses
-- as well as ordinary sessions. Ordinary single-session logout does not.
CREATE OR REPLACE FUNCTION vc.identity_change_current_password(p_password_hash text)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner_id bigint := vc.current_owner_id();
    v_changed boolean;
BEGIN
    v_changed := vc.identity_change_password(v_owner_id, p_password_hash);
    IF NOT v_changed THEN
        RETURN FALSE;
    END IF;
    PERFORM vc.identity_opaque_session_revoke_all(v_owner_id);
    PERFORM vc.identity_trusted_device_revoke_all_current();
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.identity_revoke_trusted_devices_on_status_change()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NEW.status <> 'ACTIVE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        UPDATE vc.identity_trusted_device
           SET revoked_at = now()
         WHERE account_id = NEW.id AND revoked_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER identity_account_status_revoke_trusted_devices
    AFTER UPDATE OF status ON vc.identity_account
    FOR EACH ROW EXECUTE FUNCTION vc.identity_revoke_trusted_devices_on_status_change();

REVOKE ALL ON FUNCTION vc.identity_auth_challenge_create_current(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_authenticator_enabled_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_auth_challenge_setup(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_auth_challenge_lock(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_auth_recovery_code_lock_current(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_auth_challenge_fail_current(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_auth_challenge_complete_current(text, text, text, timestamptz, bigint, text[], text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_trusted_device_login_current(text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_trusted_device_list_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_trusted_device_revoke_current(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_trusted_device_revoke_all_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_logout_all_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_admin_reset_authenticator_current(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_admin_account_list_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_admin_review_account_current(bigint, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_change_current_password(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_create_current(text, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_authenticator_enabled_current() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_setup(text, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_lock(text, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_auth_recovery_code_lock_current(text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_fail_current(text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_complete_current(text, text, text, timestamptz, bigint, text[], text, text, timestamptz, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_trusted_device_login_current(text, text, timestamptz, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_trusted_device_list_current() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_trusted_device_revoke_current(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_trusted_device_revoke_all_current() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_logout_all_current() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_admin_reset_authenticator_current(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_admin_account_list_current() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_admin_review_account_current(bigint, text, timestamptz) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_change_current_password(text) TO vc_api;

DO $$
BEGIN
    IF has_function_privilege('public',
            'vc.identity_auth_challenge_setup(text,text,timestamptz)', 'EXECUTE')
       OR has_function_privilege('public',
            'vc.identity_trusted_device_login_current(text,text,timestamptz,timestamptz)', 'EXECUTE') THEN
        RAISE EXCEPTION 'V123: public auth execution must stay revoked';
    END IF;
END;
$$;
