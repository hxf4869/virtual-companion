-- EMERGENCY-CONTACT V65: the emergency contact lifecycle (§20.14).
--
-- An emergency contact is NOT an ordinary address-book field:
--   * saving requires a standing EMERGENCY_CONTACT consent grant (FR-AUTH-003
--     separate consent, V41 consent_record latest-wins);
--   * an unverified contact is only ever a DRAFT — it can never be used for
--     an actual liaison (未验证前只能保存为草稿);
--   * verification goes through a one-time invite token (hash-only store,
--     pgcrypto digest — the plaintext token exists only in the SD result);
--   * a confirmed contact records WHEN, HOW and under WHICH consent version
--     the contact-side acceptance happened, and expires (default 180 days) —
--     expiry lazily demotes the row back to DRAFT for a fresh verification;
--   * changing the stored contact value demotes the row back to DRAFT;
--   * every read of a stored row appends an EMERGENCY_CONTACT_VIEW audit row
--     (§20.14 每次查看、解密和联系均审计 — in Alpha the read is the only
--     operation that ever decrypts; actual liaison stays a human action
--     outside the API).
--
-- The contact value itself is application-layer encrypted (§17.4 应用层加密):
-- contact_cipher stores base64(iv||AES-GCM ciphertext) produced by the legacy runtime
-- service with a deployment-injected key; SQL never sees plaintext and never
-- needs to (matching, expiry and status are all metadata).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- Audit: EMERGENCY_CONTACT_VIEW (each read of a stored contact row).
-- ---------------------------------------------------------------------------
ALTER TABLE vc.identity_auth_event
    DROP CONSTRAINT IF EXISTS identity_auth_event_event_type_check;
ALTER TABLE vc.identity_auth_event
    ADD CONSTRAINT identity_auth_event_event_type_check
        CHECK (event_type IN
            ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT', 'ACCOUNT_CREATE',
             'ACCOUNT_DISABLE', 'ACCOUNT_DELETE', 'EMERGENCY_CONTACT_VIEW'));

-- ---------------------------------------------------------------------------
-- Table + sequence.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.emergency_contact_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.emergency_contact_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.emergency_contact (
    owner_user_id      bigint      NOT NULL,
    id                 bigint      NOT NULL,
    label              text        NOT NULL,
    contact_cipher     text        NOT NULL,
    status             text        NOT NULL DEFAULT 'DRAFT',
    consent_version    text,
    verify_token_hash  text,
    invited_at         timestamptz,
    verified_at        timestamptz,
    verified_method    text,
    verified_expires_at timestamptz,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT emergency_contact_status_check CHECK (status IN
        ('DRAFT', 'VERIFIED', 'REVOKED')),
    CONSTRAINT emergency_contact_label_len CHECK (length(btrim(label)) BETWEEN 1 AND 64),
    CONSTRAINT emergency_contact_cipher_len CHECK (
        length(contact_cipher) BETWEEN 1 AND 8192),
    CONSTRAINT emergency_contact_verified_shape CHECK (
        (status = 'VERIFIED') = (verified_at IS NOT NULL
                                 AND verified_method IS NOT NULL
                                 AND verified_expires_at IS NOT NULL
                                 AND consent_version IS NOT NULL)),
    CONSTRAINT emergency_contact_token_shape CHECK (
        (verify_token_hash IS NULL) = (invited_at IS NULL))
);

-- At most one non-revoked contact per owner; revoked rows stay for audit.
CREATE UNIQUE INDEX IF NOT EXISTS emergency_contact_one_active
    ON vc.emergency_contact (owner_user_id)
    WHERE status <> 'REVOKED';

ALTER TABLE vc.emergency_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.emergency_contact FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.emergency_contact;
CREATE POLICY owner_isolation ON vc.emergency_contact FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.emergency_contact
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- upsert_emergency_contact: save or change the contact value (as cipher).
-- Requires the standing EMERGENCY_CONTACT consent grant (latest-wins).
-- Changing a stored contact demotes it back to DRAFT for re-verification.
-- Returns the row id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.upsert_emergency_contact(
    p_owner_user_id bigint,
    p_label         text,
    p_contact_cipher text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id      bigint;
    v_granted boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'upsert_emergency_contact: owner_user_id is required';
    END IF;
    IF p_label IS NULL OR btrim(p_label) = '' OR length(p_label) > 64 THEN
        RAISE EXCEPTION 'upsert_emergency_contact: label must be 1..64 characters';
    END IF;
    IF p_contact_cipher IS NULL OR btrim(p_contact_cipher) = ''
       OR length(p_contact_cipher) > 8192 THEN
        RAISE EXCEPTION 'upsert_emergency_contact: contact cipher must be 1..8192 characters';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'upsert_emergency_contact: owner_user_id must match server-trusted context';
    END IF;

    -- §20.14 step 1: the separate EMERGENCY_CONTACT consent must stand.
    SELECT c.granted INTO v_granted
      FROM vc.consent_record c
     WHERE c.owner_user_id = p_owner_user_id
       AND c.consent_type = 'EMERGENCY_CONTACT'
     ORDER BY c.id DESC
     LIMIT 1;
    IF v_granted IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'upsert_emergency_contact: EMERGENCY_CONTACT consent must be granted';
    END IF;

    SELECT id INTO v_id
      FROM vc.emergency_contact
     WHERE owner_user_id = p_owner_user_id AND status <> 'REVOKED'
     LIMIT 1;

    IF v_id IS NOT NULL THEN
        -- 联系方式变更后重新确认: back to DRAFT, verification state cleared.
        UPDATE vc.emergency_contact
           SET label = btrim(p_label),
               contact_cipher = p_contact_cipher,
               status = 'DRAFT',
               consent_version = NULL,
               verify_token_hash = NULL,
               invited_at = NULL,
               verified_at = NULL,
               verified_method = NULL,
               verified_expires_at = NULL,
               updated_at = now()
         WHERE owner_user_id = p_owner_user_id AND id = v_id;
    ELSE
        v_id := nextval('vc.emergency_contact_id_seq');
        INSERT INTO vc.emergency_contact(
            owner_user_id, id, label, contact_cipher, status)
        VALUES (p_owner_user_id, v_id, btrim(p_label), p_contact_cipher, 'DRAFT');
    END IF;

    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- start_emergency_contact_verification: mint a one-time invite token for the
-- contact-side acceptance. The hash-only token store keeps the plaintext out
-- of the database (V8/V28 pattern); the token is returned once to the caller
-- (Alpha: the caller relays it to the contact manually — nothing is sent).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.start_emergency_contact_verification(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_token text, out_invited_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id    bigint;
    v_status text;
    v_token text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'start_emergency_contact_verification: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'start_emergency_contact_verification: owner_user_id must match server-trusted context';
    END IF;

    SELECT id, status INTO v_id, v_status
      FROM vc.emergency_contact
     WHERE owner_user_id = p_owner_user_id AND status <> 'REVOKED'
     LIMIT 1;

    IF v_id IS NULL THEN
        RAISE EXCEPTION 'start_emergency_contact_verification: no contact saved';
    END IF;
    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'start_emergency_contact_verification: only a draft contact can be verified';
    END IF;

    v_token := encode(gen_random_bytes(16), 'hex');
    UPDATE vc.emergency_contact
       SET verify_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
           invited_at = now(),
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id AND id = v_id;

    RETURN QUERY SELECT v_id, v_token, now();
END;
$$;

-- ---------------------------------------------------------------------------
-- confirm_emergency_contact_verification: the contact-side acceptance. Binds
-- WHEN (verified_at), HOW (verified_method) and the consent VERSION the
-- contact accepted, and sets the 180-day verification validity. A wrong,
-- absent or stale (>7 days) token fails closed without disclosing which.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.confirm_emergency_contact_verification(
    p_owner_user_id  bigint,
    p_token          text,
    p_verified_method text,
    p_consent_version text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id     bigint;
    v_status text;
    v_hash   text;
    v_invited_at timestamptz;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: owner_user_id is required';
    END IF;
    IF p_token IS NULL OR btrim(p_token) = '' THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: token is required';
    END IF;
    IF p_verified_method IS NULL OR btrim(p_verified_method) = ''
       OR length(p_verified_method) > 64 THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: verified_method must be 1..64 characters';
    END IF;
    IF p_consent_version IS NULL OR btrim(p_consent_version) = ''
       OR length(p_consent_version) > 64 THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: consent_version must be 1..64 characters';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: owner_user_id must match server-trusted context';
    END IF;

    SELECT id, status, verify_token_hash, invited_at
      INTO v_id, v_status, v_hash, v_invited_at
      FROM vc.emergency_contact
     WHERE owner_user_id = p_owner_user_id AND status <> 'REVOKED'
     LIMIT 1;

    IF v_id IS NULL OR v_status <> 'DRAFT'
       OR v_hash IS DISTINCT FROM encode(digest(p_token, 'sha256'), 'hex') THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: verification token mismatch';
    END IF;
    IF v_invited_at < now() - interval '7 days' THEN
        RAISE EXCEPTION 'confirm_emergency_contact_verification: verification invite expired';
    END IF;

    UPDATE vc.emergency_contact
       SET status = 'VERIFIED',
           consent_version = btrim(p_consent_version),
           verified_at = now(),
           verified_method = btrim(p_verified_method),
           verified_expires_at = now() + interval '180 days',
           verify_token_hash = NULL,
           invited_at = NULL,
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id AND id = v_id;

    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- revoke_emergency_contact: the user withdraws the contact. Terminal state;
-- a new contact starts fresh (verify/verification fields cleared — history
-- lives in the consent records and the audit trail). Returns whether a live
-- contact existed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.revoke_emergency_contact(
    p_owner_user_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'revoke_emergency_contact: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'revoke_emergency_contact: owner_user_id must match server-trusted context';
    END IF;

    SELECT id INTO v_id
      FROM vc.emergency_contact
     WHERE owner_user_id = p_owner_user_id AND status <> 'REVOKED'
     LIMIT 1;

    IF v_id IS NULL THEN
        RETURN false;
    END IF;

    UPDATE vc.emergency_contact
       SET status = 'REVOKED',
           consent_version = NULL,
           verify_token_hash = NULL,
           invited_at = NULL,
           verified_at = NULL,
           verified_method = NULL,
           verified_expires_at = NULL,
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id AND id = v_id;

    RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- get_emergency_contact: the caller's live (non-revoked) contact, after the
-- lazy expiry demotion. Every read of a stored row appends an
-- EMERGENCY_CONTACT_VIEW audit row (§20.14 每次查看、解密和联系均审计).
-- No rows = nothing saved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_emergency_contact(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_label text, out_contact_cipher text,
                  out_status text, out_consent_version text,
                  out_invited_at timestamptz, out_verified_at timestamptz,
                  out_verified_method text, out_verified_expires_at timestamptz,
                  out_created_at timestamptz, out_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_emergency_contact: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_emergency_contact: owner_user_id must match server-trusted context';
    END IF;

    -- 验证过期后重新确认: an expired verification lazily demotes to DRAFT.
    UPDATE vc.emergency_contact
       SET status = 'DRAFT',
           consent_version = NULL,
           verified_at = NULL,
           verified_method = NULL,
           verified_expires_at = NULL,
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND status = 'VERIFIED'
       AND verified_expires_at < now();

    RETURN QUERY
    SELECT e.id, e.label, e.contact_cipher, e.status, e.consent_version,
           e.invited_at, e.verified_at, e.verified_method,
           e.verified_expires_at, e.created_at, e.updated_at
      FROM vc.emergency_contact e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.status <> 'REVOKED'
     LIMIT 1;

    IF FOUND THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        SELECT 'EMERGENCY_CONTACT_VIEW', a.id, a.username
          FROM vc.identity_account a
         WHERE a.id = p_owner_user_id;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.upsert_emergency_contact(bigint, text, text),
    vc.start_emergency_contact_verification(bigint),
    vc.confirm_emergency_contact_verification(bigint, text, text, text),
    vc.revoke_emergency_contact(bigint),
    vc.get_emergency_contact(bigint)
    FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.upsert_emergency_contact(bigint, text, text),
    vc.start_emergency_contact_verification(bigint),
    vc.confirm_emergency_contact_verification(bigint, text, text, text),
    vc.revoke_emergency_contact(bigint),
    vc.get_emergency_contact(bigint)
    TO vc_api;
