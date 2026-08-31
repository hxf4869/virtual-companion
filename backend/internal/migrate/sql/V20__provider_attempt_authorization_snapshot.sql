-- TASK-0164 V20: provider_attempt authorization snapshot DB enforcement (INV-AUTH-001).
--
-- INV-AUTH-001 declares "every external model attempt binds requested and
-- execution authorization snapshots" with enforcement [not_null_constraint,
-- composite_foreign_key, integration_test]. V15 created provider_attempt with
-- only 7 columns (no snapshot columns, no FK to authorization_snapshot); the
-- contract layer (InvocationBinding.ExternalAttemptBinding) already holds both
-- snapshot ids with requireNonBlank, but nothing ever reached the DB. This
-- migration lands the two DB-layer enforcement legs:
--   * not_null_constraint  : two text NOT NULL columns on provider_attempt
--   * composite_foreign_key: two composite FKs to authorization_snapshot's
--                            (owner_user_id, snapshot_id) primary key
-- The integration_test leg is carried by test 59.
--
-- Forward-only (new V20); V1-V19 are frozen (migration history checksum safety). The
-- record_provider_attempt SECURITY DEFINER function is DROP+CREATE because
-- CREATE OR REPLACE cannot change the argument list; the V17 trusted-context
-- assertion (p_owner_user_id must equal server-trusted current_owner_id) and
-- all prior validation are preserved verbatim, only the two snapshot parameters
-- and the matching INSERT columns are added. search_path is hardened to
-- vc,pg_catalog (RISK-09 direction; the function body is fully schema-qualified
-- so this changes no runtime behavior).

SET search_path TO vc, pg_catalog;

-- 1. Two NOT NULL snapshot columns. Fresh migration leaves provider_attempt
--    empty (no production write path exists yet), so ADD COLUMN NOT NULL with
--    no default is safe (no backfill problem).
ALTER TABLE vc.provider_attempt
    ADD COLUMN requested_authorization_snapshot text NOT NULL,
    ADD COLUMN execution_authorization_snapshot text NOT NULL;

-- 2. Composite FKs to authorization_snapshot(owner_user_id, snapshot_id).
--    A composite (owner_user_id, snapshot_id) FK (not the plain UNIQUE
--    snapshot_id) is what INV-AUTH-001's composite_foreign_key demands: it
--    also forbids cross-owner snapshot borrowing (owner A cannot bind owner B's
--    snapshot row). ON DELETE defaults to NO ACTION so an audited attempt pins
--    its snapshots (audit-chain integrity).
ALTER TABLE vc.provider_attempt
    ADD CONSTRAINT provider_attempt_requested_auth_snapshot_fk
    FOREIGN KEY (owner_user_id, requested_authorization_snapshot)
    REFERENCES vc.authorization_snapshot(owner_user_id, snapshot_id);

ALTER TABLE vc.provider_attempt
    ADD CONSTRAINT provider_attempt_execution_auth_snapshot_fk
    FOREIGN KEY (owner_user_id, execution_authorization_snapshot)
    REFERENCES vc.authorization_snapshot(owner_user_id, snapshot_id);

-- 3. record_provider_attempt: widen signature to bind both snapshots.
DROP FUNCTION IF EXISTS vc.record_provider_attempt(bigint, bigint, text, text, text);

CREATE FUNCTION vc.record_provider_attempt(
    p_owner_user_id                    bigint,
    p_generation_id                    bigint,
    p_provider_id                      text,
    p_supplier_name                    text,
    p_status                           text,
    p_requested_authorization_snapshot text,
    p_execution_authorization_snapshot text)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'record_provider_attempt: owner_user_id and generation_id are required';
    END IF;
    IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: provider_id is required';
    END IF;
    IF p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: supplier_name is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'CREATED','CONNECTING','STREAMING','EOS_RECEIVED','SUCCEEDED',
        'RETRYABLE_FAILED','NON_RETRYABLE_FAILED','TIMED_OUT',
        'CANCEL_REQUESTED','CANCELLED','ABANDONED_LATE'
    ) THEN
        RAISE EXCEPTION 'record_provider_attempt: unsupported status %', p_status;
    END IF;
    IF p_requested_authorization_snapshot IS NULL OR btrim(p_requested_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: requested_authorization_snapshot is required';
    END IF;
    IF p_execution_authorization_snapshot IS NULL OR btrim(p_execution_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'record_provider_attempt: execution_authorization_snapshot is required';
    END IF;

    -- The generation must exist for this owner (existence hidden otherwise).
    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_provider_attempt: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    v_id := nextval('vc.provider_attempt_id_seq');
    INSERT INTO vc.provider_attempt(
        owner_user_id, id, generation_id, provider_id, supplier_name, status,
        requested_authorization_snapshot, execution_authorization_snapshot)
    VALUES (
        p_owner_user_id, v_id, p_generation_id,
        p_provider_id, p_supplier_name, p_status,
        p_requested_authorization_snapshot, p_execution_authorization_snapshot);

    RETURN QUERY SELECT v_id, p_owner_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION
    vc.record_provider_attempt(bigint, bigint, text, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.record_provider_attempt(bigint, bigint, text, text, text, text, text)
    TO vc_api;
