-- AUTH-RECHECK V46: consent withdrawal withdraws ACTIVE authorization
-- snapshots (FR-AUTH-005).
--
-- Requirement: 用户撤回同意后，未执行任务不得继续使用旧授权向外部供应商
-- 发送数据. Every external attempt binds a requested + execution snapshot
-- (V26) and the ExecutionAuthorizationGuard re-checks both immediately
-- before outbound transfer — but a WITHDRAWN snapshot is the only state that
-- makes that re-check fail closed (AuthorizationStatus.WITHDRAWN → deny).
-- This migration adds the withdrawal primitive: when any consent record is
-- revoked (ConsentService.record with granted=false), every ACTIVE snapshot
-- of that owner is flipped to WITHDRAWN in the same transaction, so queued
-- tasks holding the old snapshots are refused at execution time while newly
-- minted snapshots (created after the withdrawal, from the current consent
-- state) proceed normally.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- withdraw_authorization_snapshots: flip every ACTIVE snapshot of the owner
-- to WITHDRAWN. Returns the number of snapshots withdrawn (0 when the owner
-- has no active snapshots — e.g. only queued work with nothing minted yet).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.withdraw_authorization_snapshots(
    p_owner_user_id bigint
)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'withdraw_authorization_snapshots: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'withdraw_authorization_snapshots: owner_user_id must match server-trusted context';
    END IF;

    UPDATE vc.authorization_snapshot
       SET status = 'WITHDRAWN'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACTIVE';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$$;

-- Closed by default: only the API ingestion role may withdraw snapshots.
REVOKE EXECUTE ON FUNCTION vc.withdraw_authorization_snapshots(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.withdraw_authorization_snapshots(bigint) TO vc_api;
