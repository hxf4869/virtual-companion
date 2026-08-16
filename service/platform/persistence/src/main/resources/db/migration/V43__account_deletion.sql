-- ACCT-DELETE V43: self-service account deletion (FR-AUTH-004).
--
-- identity_account_delete is the 注销受理 SD: the caller's own ACTIVE
-- account is deleted and the vc_user root row is removed, so the cascade
-- (V2/V14 FKs) clears the account row, its refresh sessions and ALL business
-- data (relationships, conversations, messages, memories + vectors, reminders,
-- consents, export requests, work items). The append-only compliance audit
-- trail (identity_auth_event has no FK) keeps the ACCOUNT_DELETE event — the
-- product states this retention before the user confirms.
--
-- The deletion is a tombstone by construction: once the row is gone, login
-- (identity_authenticate finds no row) and refresh (sessions cascaded away)
-- both fail with the same non-disclosing surface as an unknown account, so
-- the account can never be restored or reused. A second call (or a DISABLED
-- account) returns FALSE — existence is never disclosed.
--
-- Self-service only: the function takes the caller's own account id; the
-- runtime passes the server-verified JWT principal id, so no caller-supplied
-- target is ever trusted.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- identity_account_delete: delete the caller's own ACTIVE account.
-- Returns TRUE only for a confirmed deletion; FALSE for an absent, already
-- deleted or DISABLED account (not disclosed).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.identity_account_delete(
    p_account_id bigint
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
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_account_delete: account id is required';
    END IF;
    SELECT a.username INTO v_username
      FROM vc.identity_account a
     WHERE a.id = p_account_id
       AND a.status = 'ACTIVE';
    IF NOT FOUND THEN
        RETURN FALSE; -- absent, already deleted or disabled: not disclosed
    END IF;

    -- Audit BEFORE the deletion: the event row has no FK and survives, but
    -- writing it first keeps the record complete in the same transaction.
    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_DELETE', p_account_id, v_username);

    -- Deleting the ownership root cascades: identity_account (and its refresh
    -- sessions) plus every business table keyed on vc_user (conversations,
    -- messages, memories, reminders, consents, exports, work items...).
    DELETE FROM vc.vc_user WHERE id = p_account_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'identity_account_delete: vc_user row vanished mid-transaction';
    END IF;
    RETURN TRUE;
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit event CHECK gains ACCOUNT_DELETE.
-- ---------------------------------------------------------------------------
ALTER TABLE vc.identity_auth_event
    DROP CONSTRAINT IF EXISTS identity_auth_event_event_type_check;
ALTER TABLE vc.identity_auth_event
    ADD CONSTRAINT identity_auth_event_event_type_check
        CHECK (event_type IN
            ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
             'ACCOUNT_CREATE', 'ACCOUNT_DISABLE', 'ACCOUNT_DELETE'));

-- ---------------------------------------------------------------------------
-- consent_record (V41) is the only business table without an owner FK; add
-- the cascade so account deletion also clears consent records (FR-AUTH-004
-- 清理数据; the V41 RLS policy already scopes every row to its owner).
-- ---------------------------------------------------------------------------
ALTER TABLE vc.consent_record
    DROP CONSTRAINT IF EXISTS consent_record_owner_fk;
ALTER TABLE vc.consent_record
    ADD CONSTRAINT consent_record_owner_fk
        FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE;

-- Closed by default: only the API ingestion role may delete an account.
REVOKE EXECUTE ON FUNCTION vc.identity_account_delete(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_account_delete(bigint) TO vc_api;
