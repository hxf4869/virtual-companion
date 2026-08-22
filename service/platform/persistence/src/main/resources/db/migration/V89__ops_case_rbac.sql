-- S0-14-B: minimal ops RBAC. Case snapshot is role-and-kind scoped; reading
-- internal_note is a BODY_ACCESS audit event. USER never sees cases.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.identity_account DROP CONSTRAINT IF EXISTS identity_account_role_check;
ALTER TABLE vc.identity_account
    ADD CONSTRAINT identity_account_role_check CHECK (role IN (
        'ADMIN', 'USER', 'SAFETY_REVIEWER', 'PRIVACY_OPERATOR', 'OPS_VIEWER'));

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
    IF v_role NOT IN ('ADMIN', 'USER', 'SAFETY_REVIEWER', 'PRIVACY_OPERATOR', 'OPS_VIEWER') THEN
        RAISE EXCEPTION 'identity_account_create: unsupported role';
    END IF;
    IF p_display_name IS NULL OR btrim(p_display_name) = '' THEN
        RAISE EXCEPTION 'identity_account_create: display_name is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'identity_account_create: caller is not an active ADMIN';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('vc.identity_account_create.capacity'));
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

CREATE FUNCTION vc.ops_case_kind_permitted(p_role text, p_kind text)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_role = 'ADMIN' THEN true
        WHEN p_role = 'OPS_VIEWER' THEN true
        WHEN p_role = 'SAFETY_REVIEWER' AND p_kind = 'SAFETY' THEN true
        WHEN p_role = 'PRIVACY_OPERATOR' AND p_kind IN ('REPORT', 'AGE_APPEAL') THEN true
        ELSE false
    END;
$$;

CREATE OR REPLACE FUNCTION vc.ops_case_snapshot(p_acting_account_id bigint, p_case_id bigint)
    RETURNS TABLE(
        out_id bigint,
        out_kind text,
        out_source_owner_user_id bigint,
        out_source_id bigint,
        out_status text,
        out_severity text,
        out_sla_hours integer,
        out_assignee_account_id bigint,
        out_disposition_reason text,
        out_public_note text,
        out_opened_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_kind text;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'ops_case_snapshot: acting account is required';
    END IF;
    SELECT a.role INTO v_role
      FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL THEN
        RAISE EXCEPTION 'ops_case_snapshot: caller is not an active operator';
    END IF;
    IF p_case_id IS NULL OR p_case_id <= 0 THEN
        RAISE EXCEPTION 'ops_case_snapshot: case_id is required';
    END IF;
    SELECT c.kind INTO v_kind FROM vc.ops_case c WHERE c.id = p_case_id;
    IF v_kind IS NULL THEN
        RETURN;
    END IF;
    IF NOT vc.ops_case_kind_permitted(v_role, v_kind) THEN
        RAISE EXCEPTION 'ops_case_snapshot: kind not permitted for role';
    END IF;
    RETURN QUERY
    SELECT c.id, c.kind, c.source_owner_user_id, c.source_id, c.status, c.severity,
           c.sla_hours, c.assignee_account_id, c.disposition_reason, c.public_note,
           c.opened_at
      FROM vc.ops_case c
     WHERE c.id = p_case_id;
END;
$$;

CREATE FUNCTION vc.read_ops_case_internal_note(p_acting_account_id bigint, p_case_id bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_kind text;
    v_note text;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'read_ops_case_internal_note: acting account is required';
    END IF;
    SELECT a.role INTO v_role
      FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role = 'OPS_VIEWER' OR v_role = 'USER' THEN
        RAISE EXCEPTION 'read_ops_case_internal_note: body access denied';
    END IF;
    SELECT c.kind, c.internal_note INTO v_kind, v_note
      FROM vc.ops_case c WHERE c.id = p_case_id;
    IF v_kind IS NULL THEN
        RETURN NULL;
    END IF;
    IF NOT vc.ops_case_kind_permitted(v_role, v_kind) THEN
        RAISE EXCEPTION 'read_ops_case_internal_note: kind not permitted for role';
    END IF;
    INSERT INTO vc.ops_case_event(case_id, event_type, actor_account_id)
    VALUES (p_case_id, 'BODY_ACCESS', p_acting_account_id);
    RETURN v_note;
END;
$$;

GRANT SELECT ON vc.ops_case_event
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

REVOKE ALL ON FUNCTION vc.ops_case_kind_permitted(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.read_ops_case_internal_note(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.ops_case_kind_permitted(text, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.read_ops_case_internal_note(bigint, bigint) TO vc_api;
