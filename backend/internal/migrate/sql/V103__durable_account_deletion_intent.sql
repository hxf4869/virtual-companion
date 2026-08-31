-- S0-16: durable account-deletion intent. The intent commits before the
-- destructive delete, blocks new outbound work, cancels queued/claimed work and
-- cancellable generations, and remains as a privacy-preserving tombstone after
-- owner rows cascade away.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.account_deletion_intent (
    account_id bigint PRIMARY KEY,
    username_digest text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'REQUESTED',
    requested_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    poll_until timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
    cancelled_work_items integer NOT NULL DEFAULT 0,
    cancelled_generations integer NOT NULL DEFAULT 0,
    local_cancel_signals integer NOT NULL DEFAULT 0,
    CONSTRAINT account_deletion_intent_status CHECK (status IN ('REQUESTED', 'COMPLETED')),
    CONSTRAINT account_deletion_intent_digest CHECK (username_digest ~ '^[0-9a-f]{64}$'),
    CONSTRAINT account_deletion_intent_counts CHECK (
        cancelled_work_items >= 0 AND cancelled_generations >= 0
        AND local_cancel_signals >= 0),
    CONSTRAINT account_deletion_intent_completed CHECK (
        (status = 'COMPLETED') = (completed_at IS NOT NULL))
);

REVOKE ALL ON vc.account_deletion_intent FROM PUBLIC;

ALTER TABLE vc.identity_auth_event
    DROP CONSTRAINT identity_auth_event_event_type_check;
ALTER TABLE vc.identity_auth_event
    ADD CONSTRAINT identity_auth_event_event_type_check CHECK (event_type IN (
        'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGOUT',
        'ACCOUNT_CREATE', 'ACCOUNT_DISABLE', 'ACCOUNT_DELETE',
        'ACCOUNT_DELETE_REQUESTED', 'EMERGENCY_CONTACT_VIEW',
        'SESSION_REVOKE', 'SESSION_REVOKE_ALL', 'PASSWORD_CHANGE',
        'ADMIN_PASSWORD_RESET', 'ADMIN_REAUTH'));

CREATE FUNCTION vc.username_tombstone_digest(p_username text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    SET search_path = vc, pg_catalog
AS $$
    SELECT encode(digest(convert_to(lower(btrim(p_username)), 'UTF8'), 'sha256'), 'hex')
$$;

CREATE FUNCTION vc.reject_deleted_identity_reuse()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.username_digest = vc.username_tombstone_digest(NEW.username)) THEN
        RAISE EXCEPTION 'identity account creation rejected';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER identity_account_deleted_name_guard
BEFORE INSERT ON vc.identity_account
FOR EACH ROW EXECUTE FUNCTION vc.reject_deleted_identity_reuse();

CREATE FUNCTION vc.block_deleting_owner_outbound_rows()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                WHERE d.account_id = NEW.owner_user_id) THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER generation_deletion_intent_guard
BEFORE INSERT ON vc.generation
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE TRIGGER work_item_deletion_intent_guard
BEFORE INSERT ON vc.work_item
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE TRIGGER message_deletion_intent_guard
BEFORE INSERT OR UPDATE ON vc.message
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE TRIGGER generation_candidate_deletion_intent_guard
BEFORE INSERT OR UPDATE ON vc.generation_candidate
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE TRIGGER memory_item_deletion_intent_guard
BEFORE INSERT OR UPDATE ON vc.memory_item
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE TRIGGER memory_embedding_deletion_intent_guard
BEFORE INSERT OR UPDATE ON vc.memory_embedding
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE TRIGGER export_request_deletion_intent_guard
BEFORE INSERT OR UPDATE ON vc.export_request
FOR EACH ROW EXECUTE FUNCTION vc.block_deleting_owner_outbound_rows();

CREATE FUNCTION vc.request_account_deletion_current()
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
    v_username text;
    v_inserted boolean := false;
    v_generation record;
    v_generations integer := 0;
    v_work_items integer := 0;
BEGIN
    SELECT a.username INTO v_username FROM vc.identity_account a
     WHERE a.id = v_owner AND a.status = 'ACTIVE' FOR UPDATE;
    IF v_username IS NULL THEN
        RETURN FALSE;
    END IF;

    INSERT INTO vc.account_deletion_intent(
        account_id, username_digest, status, requested_at, completed_at, poll_until)
    VALUES (v_owner, vc.username_tombstone_digest(v_username),
            'REQUESTED', now(), NULL, now() + interval '5 minutes')
    ON CONFLICT (account_id) DO UPDATE
       SET poll_until = greatest(vc.account_deletion_intent.poll_until,
                                now() + interval '5 minutes')
     WHERE vc.account_deletion_intent.status = 'REQUESTED'
    RETURNING (xmax = 0) INTO v_inserted;

    IF v_inserted THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        VALUES ('ACCOUNT_DELETE_REQUESTED', v_owner, v_username);
    END IF;

    FOR v_generation IN
        SELECT g.id FROM vc.generation g
         WHERE g.owner_user_id = v_owner
           AND g.status IN ('CREATED', 'INPUT_REVIEW', 'QUEUED', 'IN_PROGRESS',
                            'WAITING_FOR_CAPACITY', 'FINAL_REVIEW')
         ORDER BY g.id
         FOR UPDATE
    LOOP
        PERFORM vc.cancel_generation(v_owner, v_generation.id);
        v_generations := v_generations + 1;
    END LOOP;

    UPDATE vc.work_item
       SET status = 'CANCELLED', claim_token = NULL, claim_fence = NULL,
           claimed_at = NULL, lease_expires_at = NULL, finished_at = now()
     WHERE owner_user_id = v_owner AND status IN ('PENDING', 'CLAIMED');
    GET DIAGNOSTICS v_work_items = ROW_COUNT;

    UPDATE vc.account_deletion_intent
       SET cancelled_generations = cancelled_generations + v_generations,
           cancelled_work_items = cancelled_work_items + v_work_items
     WHERE account_id = v_owner AND status = 'REQUESTED';
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.record_account_deletion_cancel_signals_current(p_count integer)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
BEGIN
    IF p_count IS NULL OR p_count < 0 THEN
        RAISE EXCEPTION 'cancel signal count is invalid';
    END IF;
    UPDATE vc.account_deletion_intent
       SET local_cancel_signals = local_cancel_signals + p_count
     WHERE account_id = v_owner;
    RETURN FOUND;
END;
$$;

CREATE FUNCTION vc.account_deletion_intent_active_current()
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT EXISTS (SELECT 1 FROM vc.account_deletion_intent d
                   WHERE d.account_id = vc.current_owner_id())
$$;

CREATE FUNCTION vc.list_account_deletion_cancellation_targets(p_limit integer)
    RETURNS TABLE(out_account_id bigint)
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT d.account_id FROM vc.account_deletion_intent d
     WHERE d.poll_until > now()
     ORDER BY d.requested_at
     LIMIT least(greatest(coalesce(p_limit, 64), 1), 256)
$$;

-- Core owner-id function remains migration-owner callable for restore/tests, but
-- vc_api loses EXECUTE below and uses the bound wrapper. It also creates the
-- tombstone when called by trusted maintenance code without a preflight intent.
CREATE OR REPLACE FUNCTION vc.identity_account_delete(p_account_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_username text;
    v_rows integer;
    v_inserted boolean := false;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_account_delete: account id is required';
    END IF;
    SELECT a.username INTO v_username FROM vc.identity_account a
     WHERE a.id = p_account_id AND a.status = 'ACTIVE' FOR UPDATE;
    IF v_username IS NULL THEN
        RETURN FALSE;
    END IF;

    INSERT INTO vc.account_deletion_intent(
        account_id, username_digest, status, requested_at, completed_at, poll_until)
    VALUES (p_account_id, vc.username_tombstone_digest(v_username),
            'REQUESTED', now(), NULL, now() + interval '5 minutes')
    ON CONFLICT (account_id) DO NOTHING
    RETURNING true INTO v_inserted;
    IF v_inserted THEN
        INSERT INTO vc.identity_auth_event(event_type, account_id, username)
        VALUES ('ACCOUNT_DELETE_REQUESTED', p_account_id, v_username);
    END IF;

    INSERT INTO vc.identity_auth_event(event_type, account_id, username)
    VALUES ('ACCOUNT_DELETE', p_account_id, v_username);
    DELETE FROM vc.vc_user WHERE id = p_account_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
        RAISE EXCEPTION 'identity_account_delete: vc_user row vanished mid-transaction';
    END IF;
    UPDATE vc.account_deletion_intent
       SET status = 'COMPLETED', completed_at = now()
     WHERE account_id = p_account_id;
    RETURN TRUE;
END;
$$;

CREATE FUNCTION vc.identity_account_delete_current()
    RETURNS boolean
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT vc.identity_account_delete(vc.current_owner_id())
$$;

REVOKE ALL ON FUNCTION vc.username_tombstone_digest(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.reject_deleted_identity_reuse() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.block_deleting_owner_outbound_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.request_account_deletion_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.record_account_deletion_cancel_signals_current(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.account_deletion_intent_active_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.list_account_deletion_cancellation_targets(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.identity_account_delete_current() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.identity_account_delete(bigint) FROM vc_api;

GRANT EXECUTE ON FUNCTION vc.request_account_deletion_current() TO vc_api;
GRANT EXECUTE ON FUNCTION vc.record_account_deletion_cancel_signals_current(integer) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.account_deletion_intent_active_current()
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.list_account_deletion_cancellation_targets(integer)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.identity_account_delete_current() TO vc_api;
