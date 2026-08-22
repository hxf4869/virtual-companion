-- S0-30: session epoch for instant access invalidation + shared sensitive-route
-- admission. Disable/logout bump epoch so the next Bearer request fails even
-- if the access JWT has not expired. Sensitive generation/SSE/export/report
-- limits are DB-backed so two runtime instances share them. Emergency-contact
-- is not a limited route.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.identity_account
    ADD COLUMN IF NOT EXISTS session_epoch integer NOT NULL DEFAULT 1;
ALTER TABLE vc.identity_account
    DROP CONSTRAINT IF EXISTS identity_account_session_epoch_check;
ALTER TABLE vc.identity_account
    ADD CONSTRAINT identity_account_session_epoch_check CHECK (session_epoch >= 1);

CREATE FUNCTION vc.identity_access_snapshot(p_account_id bigint)
    RETURNS TABLE(out_status text, out_session_epoch integer, out_role text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_access_snapshot: account_id is required';
    END IF;
    RETURN QUERY
    SELECT a.status, a.session_epoch, a.role
      FROM vc.identity_account a
     WHERE a.id = p_account_id;
END;
$$;

CREATE FUNCTION vc.identity_bump_session_epoch(p_account_id bigint)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_epoch integer;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_bump_session_epoch: account_id is required';
    END IF;
    UPDATE vc.identity_account
       SET session_epoch = session_epoch + 1
     WHERE id = p_account_id
    RETURNING session_epoch INTO v_epoch;
    IF v_epoch IS NULL THEN
        RAISE EXCEPTION 'identity_bump_session_epoch: account not found';
    END IF;
    RETURN v_epoch;
END;
$$;

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
    v_status   text;
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
    SELECT a.username, a.status INTO v_username, v_status
      FROM vc.identity_account a
     WHERE a.id = p_target_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'identity_account_disable: target account not found';
    END IF;
    UPDATE vc.identity_account
       SET status = 'DISABLED',
           session_epoch = session_epoch + 1
     WHERE id = p_target_account_id;
    IF v_status = 'ACTIVE' THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        VALUES ('ACCOUNT_DISABLE', p_target_account_id, v_username);
    END IF;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.identity_logout(
    p_account_id bigint,
    p_token_hash text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_account_id IS NULL OR p_token_hash IS NULL OR btrim(p_token_hash) = '' THEN
        RAISE EXCEPTION 'identity_logout: account_id and token_hash are required';
    END IF;
    PERFORM 1
      FROM vc.identity_refresh_token
     WHERE account_id = p_account_id AND token_hash = p_token_hash;
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    UPDATE vc.identity_refresh_token
       SET revoked_at = now()
     WHERE account_id = p_account_id
       AND token_hash = p_token_hash
       AND revoked_at IS NULL;
    IF FOUND THEN
        UPDATE vc.identity_account
           SET session_epoch = session_epoch + 1
         WHERE id = p_account_id;
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        SELECT 'LOGOUT', a.id, a.username
          FROM vc.identity_account a
         WHERE a.id = p_account_id;
    END IF;
    RETURN TRUE;
END;
$$;

CREATE TABLE vc.sensitive_route_admission (
    owner_user_id bigint NOT NULL,
    route         text NOT NULL,
    window_start  timestamptz NOT NULL,
    hits          integer NOT NULL,
    PRIMARY KEY (owner_user_id, route, window_start),
    CONSTRAINT sensitive_route_admission_hits CHECK (hits >= 0),
    CONSTRAINT sensitive_route_admission_route CHECK (
        route IN ('GENERATION', 'SSE', 'EXPORT', 'REPORT'))
);

REVOKE ALL ON vc.sensitive_route_admission FROM PUBLIC;
GRANT SELECT ON vc.sensitive_route_admission
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.admit_sensitive_route(
    p_owner_user_id   bigint,
    p_route           text,
    p_limit           integer,
    p_window_seconds  integer
)
    RETURNS TABLE(out_admitted boolean, out_retry_after integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_window timestamptz;
    v_hits integer;
    v_retry integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'admit_sensitive_route: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'admit_sensitive_route: owner_user_id must match server-trusted context';
    END IF;
    IF p_route IS NULL OR p_route NOT IN ('GENERATION', 'SSE', 'EXPORT', 'REPORT') THEN
        RAISE EXCEPTION 'admit_sensitive_route: unsupported route';
    END IF;
    IF p_limit IS NULL OR p_limit <= 0 OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RAISE EXCEPTION 'admit_sensitive_route: limit and window must be positive';
    END IF;

    v_window := to_timestamp(
        floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
    INSERT INTO vc.sensitive_route_admission(owner_user_id, route, window_start, hits)
    VALUES (p_owner_user_id, p_route, v_window, 1)
    ON CONFLICT (owner_user_id, route, window_start)
    DO UPDATE SET hits = vc.sensitive_route_admission.hits + 1
    RETURNING hits INTO v_hits;

    v_retry := GREATEST(1,
        p_window_seconds - (extract(epoch FROM now())::int
            % p_window_seconds));
    IF v_hits > p_limit THEN
        RETURN QUERY SELECT false, v_retry;
    ELSE
        RETURN QUERY SELECT true, v_retry;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION vc.identity_access_snapshot(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_bump_session_epoch(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.admit_sensitive_route(bigint, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_access_snapshot(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.identity_bump_session_epoch(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.admit_sensitive_route(bigint, text, integer, integer) TO vc_api;
