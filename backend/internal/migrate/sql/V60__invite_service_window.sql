-- INVITE / SVC-WINDOW V60: invite-code provisioning + Beta service-window
-- state.
--
-- INVITE (§7.4 邀请码和测试协议): ADMIN mints single-use invite codes; an
-- anonymous visitor redeems a code to open their own ACTIVE USER test
-- account (the same capacity gate maxEnabledAccounts=30 and the same
-- ACCOUNT_CREATE audit as direct provisioning). The redemption is atomic:
-- the code flips to USED in the same transaction as the account insert, so
-- a code can never create two accounts. Runtime registration is
-- config-gated (virtual-companion.auth.invite-registration-enabled, default
-- false — Technical Alpha keeps public registration closed).
--
-- SVC-WINDOW (§24.7 / FR-RES-002): beta_service_window_state returns the
-- daily-active-user count and whether this owner already generated today,
-- computed from vc.generation rows — the enforcement itself (time window,
-- manual pause, DAU cap) stays in the runtime pure policy class so local
-- development can leave it disabled (virtual-companion.beta.service-window
-- .enabled, default false).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- Invite codes
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.invite_code_id_seq AS bigint;

CREATE TABLE IF NOT EXISTS vc.invite_code (
    id               bigint      NOT NULL,
    code             text        NOT NULL,
    created_by_admin bigint      NOT NULL,
    status           text        NOT NULL DEFAULT 'ACTIVE',
    used_by_account  bigint,
    created_at       timestamptz NOT NULL DEFAULT now(),
    used_at          timestamptz,
    expires_at       timestamptz NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (code),
    CONSTRAINT invite_code_admin_fk
        FOREIGN KEY (created_by_admin) REFERENCES vc.identity_account(id),
    CONSTRAINT invite_code_status_check CHECK (status IN ('ACTIVE', 'USED', 'DISABLED')),
    CONSTRAINT invite_code_shape_check CHECK (
        char_length(code) >= 8 AND char_length(code) <= 64
        AND code ~ '^[A-Z0-9][A-Z0-9-]*$')
);

ALTER TABLE vc.invite_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.invite_code FORCE ROW LEVEL SECURITY;
-- No policy on purpose: runtime roles can never touch the table directly;
-- every access goes through the SECURITY DEFINER functions below.
REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.invite_code
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- create_invite_code: ADMIN mints one code (the runtime generates the random
-- value; the SD validates shape and expiry, re-verifying ACTIVE ADMIN).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_invite_code(
    p_admin_account_id bigint,
    p_code             text,
    p_expires_at       timestamptz
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'create_invite_code: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'create_invite_code: caller is not an active ADMIN';
    END IF;
    IF p_code IS NULL OR p_code !~ '^[A-Z0-9][A-Z0-9-]*$' OR char_length(p_code) < 8
       OR char_length(p_code) > 64 THEN
        RAISE EXCEPTION 'create_invite_code: code must be 8..64 upper-case alphanumeric/dash characters';
    END IF;
    IF p_expires_at IS NULL OR p_expires_at <= now() THEN
        RAISE EXCEPTION 'create_invite_code: expires_at must be in the future';
    END IF;

    v_id := nextval('vc.invite_code_id_seq');
    INSERT INTO vc.invite_code(id, code, created_by_admin, expires_at)
    VALUES (v_id, p_code, p_admin_account_id, p_expires_at);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_invite_codes: ADMIN registry read, newest first (limit clamped 1..100).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_invite_codes(
    p_admin_account_id bigint,
    p_limit            int DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_code text, out_status text,
                  out_created_at timestamptz, out_used_at timestamptz,
                  out_expires_at timestamptz, out_used_by_account bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'list_invite_codes: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'list_invite_codes: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT c.id, c.code, c.status, c.created_at, c.used_at, c.expires_at,
           c.used_by_account
      FROM vc.invite_code c
     ORDER BY c.id DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

-- ---------------------------------------------------------------------------
-- disable_invite_code: ADMIN retires an ACTIVE code (idempotent TRUE for an
-- already-disabled code; an absent code returns FALSE without disclosure).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.disable_invite_code(
    p_admin_account_id bigint,
    p_code             text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_disabled boolean;
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'disable_invite_code: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'disable_invite_code: caller is not an active ADMIN';
    END IF;

    UPDATE vc.invite_code
       SET status = 'DISABLED'
     WHERE code = p_code
       AND status = 'ACTIVE';
    IF NOT FOUND THEN
        -- Idempotent for an already-disabled code; absent stays FALSE.
        SELECT (status = 'DISABLED') INTO v_disabled
          FROM vc.invite_code WHERE code = p_code;
        RETURN COALESCE(v_disabled, FALSE);
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- redeem_invite_code: anonymous provisioning through a valid ACTIVE code.
-- Atomic: the account insert and the USED flip commit together. Same
-- capacity gate and ACCOUNT_CREATE audit as identity_account_create; the
-- role is always USER (an invite never mints an ADMIN).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.redeem_invite_code(
    p_code          text,
    p_username      text,
    p_password_hash text,
    p_display_name  text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username   text := lower(btrim(p_username));
    v_account_id bigint;
    v_active_count bigint;
BEGIN
    IF p_code IS NULL OR btrim(p_code) = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: code is required';
    END IF;
    IF v_username = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: password_hash is required';
    END IF;
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'redeem_invite_code: display_name is required';
    END IF;

    -- One uniform failure for absent, expired, used or disabled codes —
    -- existence of codes is never disclosed to an anonymous caller.
    IF NOT EXISTS (SELECT 1 FROM vc.invite_code
                    WHERE code = btrim(p_code)
                      AND status = 'ACTIVE'
                      AND expires_at > now()) THEN
        RAISE EXCEPTION 'redeem_invite_code: invite code is invalid or expired';
    END IF;

    -- betaGate maxEnabledAccounts=30 (same gate as identity_account_create).
    SELECT count(*) INTO v_active_count
      FROM vc.identity_account
     WHERE status = 'ACTIVE';
    IF v_active_count >= 30 THEN
        RAISE EXCEPTION 'redeem_invite_code: enabled account capacity reached';
    END IF;

    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, 'USER', 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);

    UPDATE vc.invite_code
       SET status = 'USED', used_by_account = v_account_id, used_at = now()
     WHERE code = btrim(p_code) AND status = 'ACTIVE';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'redeem_invite_code: invite code was consumed concurrently';
    END IF;
    RETURN v_account_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- SVC-WINDOW: DAU + owner-active state over vc.generation rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.beta_service_window_state(
    p_owner_user_id bigint,
    p_day_start     timestamptz
)
    RETURNS TABLE(out_daily_active bigint, out_owner_active boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'beta_service_window_state: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'beta_service_window_state: owner_user_id must match server-trusted context';
    END IF;
    IF p_day_start IS NULL THEN
        RAISE EXCEPTION 'beta_service_window_state: day_start is required';
    END IF;

    RETURN QUERY
    SELECT (SELECT count(DISTINCT g.owner_user_id)::bigint
              FROM vc.generation g
             WHERE g.created_at >= p_day_start),
           EXISTS (SELECT 1 FROM vc.generation g
                    WHERE g.owner_user_id = p_owner_user_id
                      AND g.created_at >= p_day_start);
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.create_invite_code(bigint, text, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_invite_codes(bigint, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.disable_invite_code(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.redeem_invite_code(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.beta_service_window_state(bigint, timestamptz) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.create_invite_code(bigint, text, timestamptz),
                vc.list_invite_codes(bigint, int),
                vc.disable_invite_code(bigint, text),
                vc.redeem_invite_code(text, text, text, text),
                vc.beta_service_window_state(bigint, timestamptz)
    TO vc_api;
