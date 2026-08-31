-- S0-11-C: shared non-monetary product quota (reserve / settle / release).
-- Survives restart; FOR UPDATE on the owner account prevents oversell.
-- Currency, vendor invoices and cost caps stay S0-29 / generation_usage.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.product_quota_account (
    owner_user_id bigint PRIMARY KEY,
    remaining     bigint NOT NULL,
    ceiling       bigint NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_quota_account_nonneg CHECK (remaining >= 0 AND ceiling >= 0),
    CONSTRAINT product_quota_account_ceiling CHECK (remaining <= ceiling),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

CREATE TABLE vc.product_quota_reservation (
    owner_user_id   bigint NOT NULL,
    reservation_id  text   NOT NULL,
    generation_id   bigint NOT NULL,
    units           bigint NOT NULL,
    status          text   NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, reservation_id),
    FOREIGN KEY (owner_user_id, generation_id)
        REFERENCES vc.generation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT product_quota_reservation_units CHECK (units > 0),
    CONSTRAINT product_quota_reservation_status CHECK (
        status IN ('RESERVED', 'SETTLED', 'RELEASED'))
);

ALTER TABLE vc.product_quota_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.product_quota_account FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.product_quota_account FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

ALTER TABLE vc.product_quota_reservation ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.product_quota_reservation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.product_quota_reservation FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.product_quota_account FROM PUBLIC;
REVOKE ALL ON vc.product_quota_reservation FROM PUBLIC;
GRANT SELECT ON vc.product_quota_account, vc.product_quota_reservation
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.reserve_product_quota(
    p_owner_user_id      bigint,
    p_generation_id      bigint,
    p_units              bigint,
    p_default_allowance  bigint
)
    RETURNS TABLE(out_reservation_id text, out_remaining bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_remaining bigint;
    v_ceiling bigint;
    v_id text;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'reserve_product_quota: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'reserve_product_quota: generation_id is required';
    END IF;
    IF p_units IS NULL OR p_units <= 0 THEN
        RAISE EXCEPTION 'reserve_product_quota: units must be positive';
    END IF;
    IF p_default_allowance IS NULL OR p_default_allowance < 0 THEN
        RAISE EXCEPTION 'reserve_product_quota: default_allowance must be non-negative';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'reserve_product_quota: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'reserve_product_quota: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    INSERT INTO vc.product_quota_account(owner_user_id, remaining, ceiling)
    VALUES (p_owner_user_id, p_default_allowance, p_default_allowance)
    ON CONFLICT (owner_user_id) DO NOTHING;

    SELECT remaining, ceiling INTO v_remaining, v_ceiling
      FROM vc.product_quota_account
     WHERE owner_user_id = p_owner_user_id
     FOR UPDATE;
    IF v_remaining IS NULL THEN
        RETURN;
    END IF;
    IF v_remaining < p_units THEN
        RETURN;
    END IF;

    v_remaining := v_remaining - p_units;
    UPDATE vc.product_quota_account
       SET remaining = v_remaining, updated_at = now()
     WHERE owner_user_id = p_owner_user_id;

    v_id := 'qr-' || gen_random_uuid()::text;
    INSERT INTO vc.product_quota_reservation(
        owner_user_id, reservation_id, generation_id, units, status)
    VALUES (p_owner_user_id, v_id, p_generation_id, p_units, 'RESERVED');

    RETURN QUERY SELECT v_id, v_remaining;
END;
$$;

CREATE FUNCTION vc.release_product_quota(
    p_owner_user_id  bigint,
    p_reservation_id text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_units bigint;
    v_status text;
    v_remaining bigint;
    v_ceiling bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'release_product_quota: owner_user_id is required';
    END IF;
    IF p_reservation_id IS NULL OR btrim(p_reservation_id) = '' THEN
        RAISE EXCEPTION 'release_product_quota: reservation_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'release_product_quota: owner_user_id must match server-trusted context';
    END IF;

    SELECT units, status INTO v_units, v_status
      FROM vc.product_quota_reservation
     WHERE owner_user_id = p_owner_user_id
       AND reservation_id = p_reservation_id
     FOR UPDATE;
    IF NOT FOUND THEN
        SELECT remaining INTO v_remaining
          FROM vc.product_quota_account WHERE owner_user_id = p_owner_user_id;
        RETURN COALESCE(v_remaining, 0);
    END IF;
    IF v_status IS DISTINCT FROM 'RESERVED' THEN
        SELECT remaining INTO v_remaining
          FROM vc.product_quota_account WHERE owner_user_id = p_owner_user_id;
        RETURN COALESCE(v_remaining, 0);
    END IF;

    SELECT remaining, ceiling INTO v_remaining, v_ceiling
      FROM vc.product_quota_account
     WHERE owner_user_id = p_owner_user_id
     FOR UPDATE;
    IF v_remaining IS NULL THEN
        RETURN 0;
    END IF;
    v_remaining := LEAST(v_ceiling, v_remaining + v_units);
    UPDATE vc.product_quota_account
       SET remaining = v_remaining, updated_at = now()
     WHERE owner_user_id = p_owner_user_id;
    UPDATE vc.product_quota_reservation
       SET status = 'RELEASED'
     WHERE owner_user_id = p_owner_user_id
       AND reservation_id = p_reservation_id;

    RETURN v_remaining;
END;
$$;

CREATE FUNCTION vc.settle_product_quota(
    p_owner_user_id  bigint,
    p_reservation_id text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_updated int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'settle_product_quota: owner_user_id is required';
    END IF;
    IF p_reservation_id IS NULL OR btrim(p_reservation_id) = '' THEN
        RAISE EXCEPTION 'settle_product_quota: reservation_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'settle_product_quota: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.product_quota_reservation
       SET status = 'SETTLED'
     WHERE owner_user_id = p_owner_user_id
       AND reservation_id = p_reservation_id
       AND status = 'RESERVED';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated = 1 OR EXISTS (
        SELECT 1 FROM vc.product_quota_reservation
         WHERE owner_user_id = p_owner_user_id
           AND reservation_id = p_reservation_id
           AND status = 'SETTLED');
END;
$$;

CREATE FUNCTION vc.product_quota_remaining(p_owner_user_id bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_remaining bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'product_quota_remaining: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'product_quota_remaining: owner_user_id must match server-trusted context';
    END IF;
    SELECT remaining INTO v_remaining
      FROM vc.product_quota_account WHERE owner_user_id = p_owner_user_id;
    RETURN COALESCE(v_remaining, 0);
END;
$$;

REVOKE ALL ON FUNCTION vc.reserve_product_quota(bigint, bigint, bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.release_product_quota(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.settle_product_quota(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.product_quota_remaining(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.reserve_product_quota(bigint, bigint, bigint, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.release_product_quota(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.settle_product_quota(bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.product_quota_remaining(bigint) TO vc_api;
