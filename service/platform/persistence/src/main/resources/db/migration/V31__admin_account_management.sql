-- TASK-ADMIN-ACCTS V31: admin account management (list + disable) and the
-- betaGate account-capacity enforcement.
--
-- Adds two ADMIN-only SECURITY DEFINER functions bound to the V14 platform
-- identity tables (no RLS on platform tables; every access flows through the
-- SD functions, which fail closed on a non-ADMIN caller):
--   * identity_account_list — the full account registry for the management UI;
--   * identity_account_disable — DISABLED status flip (idempotent), audited as
--     ACCOUNT_DISABLE; an admin may not disable their own account (the last
--     admin must stay able to manage the platform).
-- identity_account_create is redefined (CREATE OR REPLACE) to enforce the
-- product-scope betaGate maxEnabledAccounts=30 capacity: creating an account
-- while 30 ACTIVE accounts exist fails closed before any write.
-- identity_auth_event.event_type CHECK gains 'ACCOUNT_DISABLE'.

SET search_path TO vc, public;

-- ---------------------------------------------------------------------------
-- identity_account_list: ADMIN-only registry read (id, username, role, status,
-- display_name, created_at), ordered by id for a stable UI list.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_account_list(
    p_acting_account_id bigint
)
    RETURNS TABLE(
        out_account_id   bigint,
        out_username     text,
        out_role         text,
        out_status       text,
        out_display_name text,
        out_created_at   timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_account_list: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_account_list: caller is not an active ADMIN';
    END IF;
    RETURN QUERY
        SELECT a.id, a.username, a.role, a.status, a.display_name, a.created_at
          FROM vc.identity_account a
         ORDER BY a.id;
END;
$$;

-- ---------------------------------------------------------------------------
-- identity_account_disable: ADMIN-only DISABLED flip (idempotent — an already
-- disabled account reports TRUE). Self-disable is rejected (an admin cannot
-- lock themselves out). An unknown target fails closed with a generic error
-- (existence is never disclosed). The DISABLED status is enforced at login /
-- refresh by the existing identity_authenticate flow.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_account_disable(
    p_acting_account_id bigint,
    p_target_account_id bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username text;
    v_rows     int;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_account_disable: acting account is required';
    END IF;
    IF p_target_account_id IS NULL OR p_target_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_account_disable: target account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_account_disable: caller is not an active ADMIN';
    END IF;
    IF p_acting_account_id = p_target_account_id THEN
        RAISE EXCEPTION 'identity_account_disable: an admin cannot disable their own account';
    END IF;
    SELECT a.username INTO v_username
      FROM vc.identity_account a
     WHERE a.id = p_target_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'identity_account_disable: target account not found';
    END IF;
    UPDATE vc.identity_account
       SET status = 'DISABLED'
     WHERE id = p_target_account_id
       AND status = 'ACTIVE';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    -- Audit only the actual flip; an already-disabled account stays idempotent
    -- without duplicating the ACCOUNT_DISABLE event.
    IF v_rows > 0 THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        VALUES ('ACCOUNT_DISABLE', p_target_account_id, v_username);
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- betaGate capacity: product-scope.yaml betaGate.maxEnabledAccounts = 30.
-- Redefine identity_account_create with a fail-closed capacity check before
-- any write (the ACTIVE count is read inside the SD context, not trusted from
-- the caller).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_account_create(
    p_acting_account_id bigint,
    p_username          text,
    p_password_hash     text,
    p_role              text,
    p_display_name      text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username    text := lower(btrim(p_username));
    v_role        text := upper(btrim(p_role));
    v_account_id  bigint;
    v_active_count bigint;
BEGIN
    IF p_acting_account_id IS NULL THEN
        RAISE EXCEPTION 'identity_account_create: acting account is required';
    END IF;
    IF v_username = '' THEN
        RAISE EXCEPTION 'identity_account_create: username is required';
    END IF;
    IF p_password_hash IS NULL OR btrim(p_password_hash) = '' THEN
        RAISE EXCEPTION 'identity_account_create: password_hash is required';
    END IF;
    IF v_role NOT IN ('ADMIN', 'USER') THEN
        RAISE EXCEPTION 'identity_account_create: role must be ADMIN or USER';
    END IF;
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'identity_account_create: display_name is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_account_create: caller is not an active ADMIN';
    END IF;
    -- betaGate maxEnabledAccounts=30 (product-scope): fail closed at capacity.
    SELECT count(*) INTO v_active_count
      FROM vc.identity_account
     WHERE status = 'ACTIVE';
    IF v_active_count >= 30 THEN
        RAISE EXCEPTION 'identity_account_create: enabled account capacity reached';
    END IF;
    v_account_id := nextval('vc.identity_account_id_seq');
    INSERT INTO vc.vc_user(id, display_name)
    VALUES (v_account_id, btrim(p_display_name));
    INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name)
    VALUES (v_account_id, v_username, p_password_hash, v_role, 'ACTIVE', btrim(p_display_name));
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_CREATE', v_account_id, v_username);
    RETURN v_account_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit event CHECK gains ACCOUNT_DISABLE.
-- ---------------------------------------------------------------------------
ALTER TABLE vc.identity_auth_event
    DROP CONSTRAINT IF EXISTS identity_auth_event_event_type_check;
ALTER TABLE vc.identity_auth_event
    ADD CONSTRAINT identity_auth_event_event_type_check
        CHECK (event_type IN
            ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
             'ACCOUNT_CREATE', 'ACCOUNT_DISABLE'));

-- ---------------------------------------------------------------------------
-- Privileges: EXECUTE granted to vc_api alone, mirroring V14.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION vc.identity_account_list(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_account_disable(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.identity_account_list(bigint),
                vc.identity_account_disable(bigint, bigint)
    TO vc_api;
