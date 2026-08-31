-- TASK-0016 V5: Worker claim, lease, fence and late-write rejection.
--
-- work_item holds opaque units of background work, owned per tenant. Workers
-- claim a batch atomically through a SECURITY DEFINER function that binds the
-- tenant context (vc.owner_user_id + vc.job_fence) for the transaction and
-- issues an opaque claim token. Every later write (renew/complete/fail/cancel)
-- is accepted only when the token, the CURRENT fence, the lease and the owner
-- all match; any stale, expired, mismatched or context-less attempt updates
-- zero rows (fail closed). INV-WORKER-001.
--
-- The functions run DEFINER-style (owned by the migration principal) and bypass
-- RLS, so each enforces owner/token/fence/lease explicitly in its WHERE clause.
-- FORCE RLS still binds direct table access by the NOBYPASSRLS runtime roles.

SET search_path TO vc, public;

CREATE TABLE IF NOT EXISTS vc.work_item (
    owner_user_id    bigint NOT NULL,
    id               bigint NOT NULL,
    -- Opaque metadata the coordinator may read.
    kind             text NOT NULL,
    ref_id           bigint NOT NULL,
    -- Opaque payload the worker reads; coordinators never see it.
    payload          bytea,
    status           text NOT NULL DEFAULT 'PENDING',
    claim_token      text,
    claim_fence      text,
    claimed_at       timestamptz,
    lease_expires_at timestamptz,
    finished_at      timestamptz,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT work_item_status CHECK (
        status IN ('PENDING', 'CLAIMED', 'DONE', 'FAILED', 'CANCELLED')
    )
);

ALTER TABLE vc.work_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.work_item FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.work_item;
CREATE POLICY owner_isolation ON vc.work_item FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- claim_work_items: atomically claim up to p_limit pending items for one owner,
-- bind the tenant context and return the claimed rows + a shared claim token.
-- A worker therefore never scans across tenants; it claims within one context.
CREATE OR REPLACE FUNCTION vc.claim_work_items(
    p_owner_user_id bigint,
    p_fence text,
    p_lease_seconds integer DEFAULT 30,
    p_limit integer DEFAULT 16
)
    RETURNS TABLE(owner_user_id bigint, id bigint, kind text, ref_id bigint,
                  payload bytea, claim_token text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_token text := gen_random_uuid()::text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'owner_user_id is required to claim work';
    END IF;
    -- A stale or empty fence refuses to establish a job context (TASK-0015
    -- fail-closed skeleton extended here).
    IF p_fence IS NULL OR btrim(p_fence) = '' OR p_fence = 'STALE' THEN
        RAISE EXCEPTION 'stale or missing fence refuses work claim';
    END IF;
    PERFORM set_config('vc.owner_user_id', p_owner_user_id::text, true);
    PERFORM set_config('vc.job_fence', p_fence, true);

    RETURN QUERY
    WITH picked AS (
        SELECT wi.id
        FROM vc.work_item wi
        WHERE wi.owner_user_id = p_owner_user_id
          AND wi.status = 'PENDING'
        ORDER BY wi.id
        FOR UPDATE OF wi SKIP LOCKED
        LIMIT GREATEST(p_limit, 1)
    )
    UPDATE vc.work_item u
       SET status = 'CLAIMED',
           claim_token = v_token,
           claim_fence = p_fence,
           claimed_at = now(),
           lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 1))
      FROM picked
     WHERE u.owner_user_id = p_owner_user_id
       AND u.id = picked.id
    RETURNING u.owner_user_id, u.id, u.kind, u.ref_id, u.payload, v_token;
END;
$$;

-- Internal guard inlined by every late write (renew_lease and _terminalize).
-- There is intentionally no callable _claim_is_live function: a live-claim probe
-- must not be invokable by roles that should only read metadata.

-- Renew: extend the lease of a still-live claim. Returns rows affected (0 on
-- any stale/expired/mismatched condition).
CREATE OR REPLACE FUNCTION vc.renew_lease(
    p_token text,
    p_lease_seconds integer DEFAULT 30
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows integer;
BEGIN
    -- A NULL owner (no tenant context) makes the equality match nothing, so a
    -- context-less renewal writes zero rows rather than raising.
    UPDATE vc.work_item
       SET lease_expires_at = now() + make_interval(secs => GREATEST(p_lease_seconds, 1))
     WHERE owner_user_id = v_owner
       AND claim_token = p_token
       AND claim_fence = NULLIF(current_setting('vc.job_fence', true), '')
       AND status = 'CLAIMED'
       AND lease_expires_at > now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Terminalize a live claim to p_new_status. Zero rows on any failed guard
-- (stale fence, expired lease, wrong token, or missing tenant context).
CREATE OR REPLACE FUNCTION vc._terminalize(
    p_token text,
    p_new_status text
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, public
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_rows integer;
BEGIN
    UPDATE vc.work_item
       SET status = p_new_status, finished_at = now()
     WHERE owner_user_id = v_owner
       AND claim_token = p_token
       AND claim_fence = NULLIF(current_setting('vc.job_fence', true), '')
       AND status = 'CLAIMED'
       AND lease_expires_at > now();
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION vc.complete_work_item(p_token text)
    RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = vc, public
AS $$ SELECT vc._terminalize(p_token, 'DONE'); $$;

CREATE OR REPLACE FUNCTION vc.fail_work_item(p_token text)
    RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = vc, public
AS $$ SELECT vc._terminalize(p_token, 'FAILED'); $$;

CREATE OR REPLACE FUNCTION vc.cancel_work_item(p_token text)
    RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = vc, public
AS $$ SELECT vc._terminalize(p_token, 'CANCELLED'); $$;

-- Worker reaches work_item ONLY through the SECURITY DEFINER functions, so the
-- lease/fence/token guards are always enforced. vc_worker gets NO direct table
-- DML (a direct UPDATE would bypass _terminalize). The coordinator reads OPAQUE
-- METADATA ONLY: a column-level grant covers every column except payload, so a
-- coordinator can never read the work payload via the table.
REVOKE ALL ON vc.work_item FROM PUBLIC;
GRANT SELECT (owner_user_id, id, kind, ref_id, status, claimed_at, lease_expires_at, finished_at)
    ON vc.work_item TO vc_job_coordinator;
-- vc_worker may READ work_item (its own rows, RLS-enforced) but NOT write
-- directly: every write goes through the SECURITY DEFINER functions so the
-- lease/fence/token guards are always enforced. No INSERT/UPDATE/DELETE grant.
GRANT SELECT ON vc.work_item TO vc_worker;
-- Functions default to PUBLIC EXECUTE; revoke it so only vc_worker may call
-- them. This also blocks vc_job_coordinator from calling claim_work_items,
-- whose return signature includes the opaque payload (closing the function
-- bypass of the column-level isolation).
REVOKE EXECUTE ON FUNCTION
    vc.claim_work_items(bigint, text, integer, integer),
    vc.renew_lease(text, integer),
    vc.complete_work_item(text),
    vc.fail_work_item(text),
    vc.cancel_work_item(text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.claim_work_items(bigint, text, integer, integer),
    vc.renew_lease(text, integer),
    vc.complete_work_item(text),
    vc.fail_work_item(text),
    vc.cancel_work_item(text)
    TO vc_worker;
