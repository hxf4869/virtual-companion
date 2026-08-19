-- ENT-TRIAL / QUOTA-PERSIST V61: simulated trial grants + quota
-- reconciliation.
--
-- ENT-TRIAL (FR-ENT-005/006): vc.trial_grant is an ADMIN-granted, per-owner
-- simulated trial (PREMIUM for a bounded turn budget and expiry). mint_
-- entitlement_snapshot consults an active trial FIRST: the first mint of a
-- generation consumes one trial turn in the same transaction (idempotent
-- re-mints of the same generation never double-consume), expiry/consumption
-- lazily terminalize the grant, and a spent/expired trial falls back to the
-- ADMIN assignment (or ECONOMY). The snapshot now also records the ENTITLED
-- class alongside the ACTUAL minted class (identical today; they diverge
-- only under a future degradation, FR-ENT-006 应得 vs 实际). Trials never
-- touch chats, memories or relationships (FR-ENT-005: 试用结束不删除).
--
-- QUOTA-PERSIST (§12.4/§12.26): admin_quota_reconciliation reconciles the
-- quota ledger against generation terminal states over a window — settled
-- and released volumes, and three anomaly classes (settled-but-not-completed,
-- completed-but-unsettled, failed-without-release); admin_provider_registry
-- exposes the persisted deployment registry (V4) for the same console.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- ENT-TRIAL: trial grants
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.trial_grant_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.trial_grant_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.trial_grant (
    owner_user_id   bigint      NOT NULL,
    id              bigint      NOT NULL,
    granted_by      bigint      NOT NULL,
    initial_turns   integer     NOT NULL,
    remaining_turns integer     NOT NULL,
    status          text        NOT NULL DEFAULT 'ACTIVE',
    granted_at      timestamptz NOT NULL DEFAULT now(),
    expires_at      timestamptz NOT NULL,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT trial_grant_turns_check CHECK (
        initial_turns > 0 AND remaining_turns >= 0 AND remaining_turns <= initial_turns),
    CONSTRAINT trial_grant_status_check CHECK (status IN ('ACTIVE', 'EXPIRED', 'CONSUMED'))
);

ALTER TABLE vc.trial_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.trial_grant FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.trial_grant;
CREATE POLICY owner_isolation ON vc.trial_grant FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.trial_grant
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- grant_trial: ADMIN grants one simulated trial (turn budget + expiry). A
-- concurrent ACTIVE trial is replaced (the old one terminalizes CONSUMED) so
-- a single owner never has two live budgets.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.grant_trial(
    p_admin_account_id bigint,
    p_owner_user_id    bigint,
    p_turns            int,
    p_days             int
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
        RAISE EXCEPTION 'grant_trial: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'grant_trial: caller is not an active ADMIN';
    END IF;
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'grant_trial: owner_user_id is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.vc_user WHERE id = p_owner_user_id) THEN
        RAISE EXCEPTION 'grant_trial: owner user not found';
    END IF;
    IF p_turns IS NULL OR p_turns < 1 OR p_turns > 1000 THEN
        RAISE EXCEPTION 'grant_trial: turns must be 1..1000';
    END IF;
    IF p_days IS NULL OR p_days < 1 OR p_days > 90 THEN
        RAISE EXCEPTION 'grant_trial: days must be 1..90';
    END IF;

    UPDATE vc.trial_grant
       SET status = 'CONSUMED'
     WHERE owner_user_id = p_owner_user_id AND status = 'ACTIVE';

    v_id := nextval('vc.trial_grant_id_seq');
    INSERT INTO vc.trial_grant(owner_user_id, id, granted_by, initial_turns,
                               remaining_turns, expires_at)
    VALUES (p_owner_user_id, v_id, p_admin_account_id, p_turns, p_turns,
            now() + make_interval(days => p_days));
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- trial_status: the owner's live trial state (trusted-owner). Expired ACTIVE
-- grants terminalize here (lazy EXPIRED).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.trial_status(
    p_owner_user_id bigint
)
    RETURNS TABLE(out_id bigint, out_remaining_turns int, out_expires_at timestamptz,
                  out_entitled_class text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'trial_status: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'trial_status: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.trial_grant
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACTIVE'
       AND expires_at <= now();

    RETURN QUERY
    SELECT t.id, t.remaining_turns, t.expires_at, 'PREMIUM'::text
      FROM vc.trial_grant t
     WHERE t.owner_user_id = p_owner_user_id
       AND t.status = 'ACTIVE'
     ORDER BY t.id DESC
     LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- mint_entitlement_snapshot: trial-first, idempotent per generation.
-- Re-defined from V40: identical behavior without an active trial; with one,
-- the first mint of a NEW generation consumes one turn and mints PREMIUM
-- with source TRIAL_GRANT. entitlement_snapshot gains entitled_service_class
-- (identical to service_class today; the degradation round fills the gap).
-- ---------------------------------------------------------------------------
ALTER TABLE vc.entitlement_snapshot
    ADD COLUMN IF NOT EXISTS entitled_service_class text;

-- The return type gains out_entitled_service_class, so this is a
-- DROP+CREATE (V44 list_messages precedent), not CREATE OR REPLACE.
DROP FUNCTION IF EXISTS vc.mint_entitlement_snapshot(bigint, bigint);

CREATE OR REPLACE FUNCTION vc.mint_entitlement_snapshot(
    p_owner_user_id bigint,
    p_generation_id bigint
)
    RETURNS TABLE(out_id bigint, out_service_class text, out_entitled_service_class text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_class     text := 'ECONOMY';
    v_entitled  text := 'ECONOMY';
    v_source    text := 'ADMIN_ASSIGNMENT';
    v_trial_id  bigint;
    v_id        bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: generation id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'mint_entitlement_snapshot: owner_user_id must match server-trusted context';
    END IF;

    -- Idempotent: a re-run (retry/recovery) resolves the existing snapshot
    -- and never consumes a second trial turn.
    SELECT e.id, e.service_class, e.entitled_service_class
      INTO v_id, v_class, v_entitled
      FROM vc.entitlement_snapshot e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.generation_id = p_generation_id;
    IF FOUND THEN
        RETURN QUERY SELECT v_id, v_class,
            COALESCE(v_entitled, v_class);
        RETURN;
    END IF;

    -- Lazy trial terminalization, then the live grant (if any) wins.
    UPDATE vc.trial_grant
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACTIVE' AND expires_at <= now();

    SELECT t.id INTO v_trial_id
      FROM vc.trial_grant t
     WHERE t.owner_user_id = p_owner_user_id
       AND t.status = 'ACTIVE' AND t.remaining_turns > 0
     ORDER BY t.id DESC
     LIMIT 1
       FOR UPDATE;

    IF v_trial_id IS NOT NULL THEN
        v_entitled := 'PREMIUM';
        v_class := 'PREMIUM';
        v_source := 'TRIAL_GRANT';
        UPDATE vc.trial_grant
           SET remaining_turns = remaining_turns - 1,
               status = CASE WHEN remaining_turns - 1 <= 0 THEN 'CONSUMED' ELSE status END
         WHERE owner_user_id = p_owner_user_id AND id = v_trial_id;
    ELSE
        SELECT COALESCE(s.service_class, 'ECONOMY') INTO v_entitled
          FROM (SELECT p_owner_user_id AS owner_user_id) o
          LEFT JOIN vc.service_class_assignment s
            ON s.owner_user_id = o.owner_user_id;
        v_class := v_entitled;
    END IF;

    v_id := nextval('vc.entitlement_snapshot_id_seq');
    INSERT INTO vc.entitlement_snapshot
        (owner_user_id, id, generation_id, service_class, source, entitled_service_class)
    VALUES
        (p_owner_user_id, v_id, p_generation_id, v_class, v_source, v_entitled);
    RETURN QUERY SELECT v_id, v_class, v_entitled;
END;
$$;

-- ---------------------------------------------------------------------------
-- QUOTA-PERSIST: ledger reconciliation against generation terminal states.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_quota_reconciliation(
    p_admin_account_id bigint,
    p_since            timestamptz DEFAULT now() - interval '14 days'
)
    RETURNS TABLE(out_settled_count bigint, out_settled_amount bigint,
                  out_released_count bigint, out_released_amount bigint,
                  out_settled_not_completed bigint,
                  out_completed_not_settled bigint,
                  out_failed_without_release bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_quota_reconciliation: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_quota_reconciliation: caller is not an active ADMIN';
    END IF;

    SELECT count(*), COALESCE(sum(l.quota_amount), 0)
      INTO out_settled_count, out_settled_amount
      FROM vc.quota_ledger_entry l
     WHERE l.kind = 'SETTLE' AND l.created_at >= p_since;

    SELECT count(*), COALESCE(sum(l.quota_amount), 0)
      INTO out_released_count, out_released_amount
      FROM vc.quota_ledger_entry l
     WHERE l.kind = 'RELEASE' AND l.created_at >= p_since;

    -- A settle whose generation is not a success terminal is an anomaly.
    SELECT count(*) INTO out_settled_not_completed
      FROM vc.quota_ledger_entry l
      JOIN vc.generation g
        ON g.owner_user_id = l.owner_user_id AND g.id = l.generation_id
     WHERE l.kind = 'SETTLE' AND l.created_at >= p_since
       AND g.status NOT IN ('COMPLETED', 'COMPLETED_FALLBACK');

    -- A success terminal without a settle never billed the turn.
    SELECT count(*) INTO out_completed_not_settled
      FROM vc.generation g
     WHERE g.created_at >= p_since
       AND g.status IN ('COMPLETED', 'COMPLETED_FALLBACK')
       AND EXISTS (SELECT 1 FROM vc.generation_attempt a
                    WHERE a.owner_user_id = g.owner_user_id AND a.generation_id = g.id)
       AND NOT EXISTS (SELECT 1 FROM vc.quota_ledger_entry l
                        WHERE l.owner_user_id = g.owner_user_id
                          AND l.generation_id = g.id AND l.kind = 'SETTLE');

    -- A failed terminal without a release never reversed its reservation.
    SELECT count(*) INTO out_failed_without_release
      FROM vc.generation g
     WHERE g.created_at >= p_since
       AND g.status IN ('FAILED_FINAL', 'OUTPUT_BLOCKED', 'INPUT_BLOCKED')
       AND EXISTS (SELECT 1 FROM vc.generation_attempt a
                    WHERE a.owner_user_id = g.owner_user_id AND a.generation_id = g.id)
       AND NOT EXISTS (SELECT 1 FROM vc.quota_ledger_entry l
                        WHERE l.owner_user_id = g.owner_user_id
                          AND l.generation_id = g.id AND l.kind = 'RELEASE');
END;
$$;

-- ---------------------------------------------------------------------------
-- QUOTA-PERSIST: the persisted deployment registry (V4) for the console.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_provider_registry(
    p_admin_account_id bigint
)
    RETURNS TABLE(out_provider_id text, out_protocol text, out_admission_state text,
                  out_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_provider_registry: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_provider_registry: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT d.provider_id, d.protocol, d.admission_state, d.updated_at
      FROM vc.provider_deployment d
     ORDER BY d.provider_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.mint_entitlement_snapshot(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.mint_entitlement_snapshot(bigint, bigint) TO vc_api;

REVOKE EXECUTE ON FUNCTION vc.grant_trial(bigint, bigint, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.trial_status(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_quota_reconciliation(bigint, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_provider_registry(bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.grant_trial(bigint, bigint, int, int),
                vc.trial_status(bigint),
                vc.admin_quota_reconciliation(bigint, timestamptz),
                vc.admin_provider_registry(bigint)
    TO vc_api;
