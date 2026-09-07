-- 2026-09-06 remediation round, N-08 (F-08): account-level one-time TOTP
-- consumption (RFC 6238 §5.2).
--
-- Completing a challenge consumed the challenge, not the OTP: within the
-- 30-second validity window (plus one drift step) the same code could create
-- a second session from a second challenge. The persisted egress state now
-- records the last consumed timestep per account, bound to the account's
-- current authenticator key:
--
--   * identity_auth_challenge_lock also returns the stored step, so the
--     verifier decides on the freshest committed value while holding the
--     account row lock (concurrent verifications serialize here);
--   * identity_auth_challenge_complete_current consumes the matched step in
--     the SAME transaction that consumes the challenge and creates the
--     session. A repeated or regressed step for the current key aborts the
--     transaction — no second session, and a rolled-back verification leaves
--     neither a consumed step nor a session behind;
--   * TOTP_ENROLL activates a new key and overwrites the record with that
--     key's first consumption, so an old key's record can never block the
--     new key (admin reset clears it the same way);
--   * no plaintext code is ever stored — only the wall-clock step number.
--   * recovery codes keep their independent one-time hash consumption and
--     never touch the timestep record.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.identity_account
    ADD COLUMN IF NOT EXISTS totp_last_consumed_step bigint
    CHECK (totp_last_consumed_step IS NULL OR totp_last_consumed_step >= 0);

-- ---------------------------------------------------------------------------
-- The lock gains the stored step: the verifier reads it under the same
-- account row lock it already takes, so a competing verification that just
-- consumed a step is visible before this one validates.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.identity_auth_challenge_lock(text, text, timestamptz);
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
        out_pending_totp_ciphertext text,
        out_totp_last_consumed_step bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT a.id, a.role, COALESCE(a.email, a.username), a.password_must_change,
           a.totp_secret_ciphertext, c.pending_totp_secret_ciphertext,
           a.totp_last_consumed_step
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

-- ---------------------------------------------------------------------------
-- The completion consumes the matched step atomically with session creation.
-- p_totp_consumed_step is the step the caller's validation matched for the
-- account's CURRENT key (TOTP_VERIFY) or the newly enrolled key
-- (TOTP_ENROLL); NULL means this completion is not a TOTP acceptance (the
-- recovery-code path) and leaves the record untouched.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS vc.identity_auth_challenge_complete_current(
    text, text, text, timestamptz, bigint, text[], text, text, timestamptz, timestamptz);
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
    p_now timestamptz,
    p_totp_consumed_step bigint
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
       OR p_session_expires_at IS NULL OR p_session_expires_at <= p_now
       OR (p_totp_consumed_step IS NOT NULL AND p_totp_consumed_step < 0) THEN
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
        -- New-key semantics: the freshly enrolled key's first consumption
        -- replaces whatever the previous key recorded.
        UPDATE vc.identity_account
           SET totp_secret_ciphertext = v_pending,
               totp_enabled_at = p_now,
               totp_last_consumed_step = p_totp_consumed_step
         WHERE id = v_owner_id;
        DELETE FROM vc.identity_mfa_recovery_code WHERE account_id = v_owner_id;
        INSERT INTO vc.identity_mfa_recovery_code(account_id, code_hash, created_at)
        SELECT v_owner_id, h, p_now FROM unnest(p_new_recovery_hashes) h;
    ELSIF p_totp_consumed_step IS NOT NULL THEN
        -- Current-key semantics (TOTP_VERIFY): a repeated or regressed step
        -- must not create a second session. The abort rolls back the whole
        -- completion — no session, no consumption.
        UPDATE vc.identity_account
           SET totp_last_consumed_step = p_totp_consumed_step
         WHERE id = v_owner_id
           AND (totp_last_consumed_step IS NULL
                OR p_totp_consumed_step > totp_last_consumed_step);
        IF NOT FOUND THEN
            RAISE EXCEPTION 'identity_auth_challenge_complete_current: totp step already consumed';
        END IF;
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

-- ---------------------------------------------------------------------------
-- Admin reset removes the authenticator key: the consumed-step record is
-- bound to that key and must not survive it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_admin_reset_authenticator_current(p_target_account_id bigint)
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
           totp_enabled_at = NULL,
           totp_last_consumed_step = NULL
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

-- The dropped lock/complete functions lost their grants (new OIDs); the
-- reset function was replaced in place and keeps its grant.
REVOKE ALL ON FUNCTION vc.identity_auth_challenge_lock(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_lock(text, text, timestamptz) TO vc_api;

REVOKE ALL ON FUNCTION vc.identity_auth_challenge_complete_current(
    text, text, text, timestamptz, bigint, text[], text, text, timestamptz, timestamptz, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_auth_challenge_complete_current(
    text, text, text, timestamptz, bigint, text[], text, text, timestamptz, timestamptz, bigint) TO vc_api;
