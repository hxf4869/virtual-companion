-- S0-30 completion: shared anonymous auth-source rate limits and DB-backed
-- concurrent leases for generation/SSE. Only HMAC digests are stored; no raw IP,
-- credential or token is persisted.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.shared_auth_source_admission (
    source_digest text NOT NULL,
    route text NOT NULL,
    window_start timestamptz NOT NULL,
    hits integer NOT NULL DEFAULT 0,
    PRIMARY KEY (source_digest, route, window_start),
    CONSTRAINT shared_auth_source_digest CHECK (source_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT shared_auth_source_route CHECK (route IN ('LOGIN', 'REFRESH')),
    CONSTRAINT shared_auth_source_hits CHECK (hits >= 0)
);

CREATE TABLE vc.sensitive_route_lease (
    lease_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id bigint NOT NULL,
    route text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT sensitive_route_lease_route CHECK (route IN ('GENERATION', 'SSE')),
    CONSTRAINT sensitive_route_lease_expiry CHECK (expires_at > created_at)
);
CREATE INDEX sensitive_route_lease_active_idx
    ON vc.sensitive_route_lease(owner_user_id, route, expires_at);

REVOKE ALL ON vc.shared_auth_source_admission, vc.sensitive_route_lease FROM PUBLIC;

CREATE FUNCTION vc.admit_shared_auth_source(
    p_source_digest text,
    p_route text,
    p_limit integer,
    p_window_seconds integer
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
    IF p_source_digest IS NULL OR p_source_digest !~ '^[0-9a-f]{64}$'
       OR p_route IS NULL OR p_route NOT IN ('LOGIN', 'REFRESH')
       OR p_limit IS NULL OR p_limit <= 0
       OR p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RAISE EXCEPTION 'admit_shared_auth_source: invalid request';
    END IF;
    DELETE FROM vc.shared_auth_source_admission
     WHERE source_digest = p_source_digest AND route = p_route
       AND window_start < now() - interval '1 day';
    v_window := to_timestamp(
        floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);
    INSERT INTO vc.shared_auth_source_admission(source_digest, route, window_start, hits)
    VALUES (p_source_digest, p_route, v_window, 1)
    ON CONFLICT (source_digest, route, window_start)
    DO UPDATE SET hits = vc.shared_auth_source_admission.hits + 1
    RETURNING hits INTO v_hits;
    v_retry := greatest(1, p_window_seconds
        - (extract(epoch FROM now())::integer % p_window_seconds));
    RETURN QUERY SELECT v_hits <= p_limit, v_retry;
END;
$$;

CREATE FUNCTION vc.acquire_sensitive_route_lease(
    p_owner_user_id bigint,
    p_route text,
    p_max_concurrent integer,
    p_ttl_seconds integer
)
    RETURNS TABLE(out_lease_id uuid, out_admitted boolean, out_retry_after integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_count integer;
    v_lease uuid;
BEGIN
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'acquire_sensitive_route_lease: owner mismatch';
    END IF;
    IF p_route IS NULL OR p_route NOT IN ('GENERATION', 'SSE')
       OR p_max_concurrent IS NULL OR p_max_concurrent <= 0
       OR p_ttl_seconds IS NULL OR p_ttl_seconds <= 0 THEN
        RAISE EXCEPTION 'acquire_sensitive_route_lease: invalid request';
    END IF;
    PERFORM pg_advisory_xact_lock(
        hashtextextended(p_owner_user_id::text || ':' || p_route, 0));
    DELETE FROM vc.sensitive_route_lease
     WHERE owner_user_id = p_owner_user_id AND route = p_route
       AND expires_at <= now();
    SELECT count(*) INTO v_count FROM vc.sensitive_route_lease
     WHERE owner_user_id = p_owner_user_id AND route = p_route
       AND expires_at > now();
    IF v_count >= p_max_concurrent THEN
        RETURN QUERY SELECT NULL::uuid, false, least(p_ttl_seconds, 60);
        RETURN;
    END IF;
    INSERT INTO vc.sensitive_route_lease(owner_user_id, route, expires_at)
    VALUES (p_owner_user_id, p_route, now() + make_interval(secs => p_ttl_seconds))
    RETURNING lease_id INTO v_lease;
    RETURN QUERY SELECT v_lease, true, 1;
END;
$$;

-- Release may execute from an async SSE completion callback after the request's
-- owner transaction has ended. The unguessable UUID plus owner must both match;
-- no row data is returned and expiry is the final fail-safe.
CREATE FUNCTION vc.release_sensitive_route_lease(
    p_owner_user_id bigint,
    p_lease_id uuid
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 OR p_lease_id IS NULL THEN
        RETURN FALSE;
    END IF;
    DELETE FROM vc.sensitive_route_lease
     WHERE owner_user_id = p_owner_user_id AND lease_id = p_lease_id;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vc.admit_shared_auth_source(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.acquire_sensitive_route_lease(bigint, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.release_sensitive_route_lease(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.admit_shared_auth_source(text, text, integer, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.acquire_sensitive_route_lease(bigint, text, integer, integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.release_sensitive_route_lease(bigint, uuid) TO vc_api;
