-- S0-12: human age-appeal approve/deny/reverify/suspend with RBAC and audit.
-- Technical Alpha still uses the simulated adapter; no document or biometric
-- material is accepted or stored by this schema.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.age_appeal
    ADD COLUMN resolution_decision text,
    ADD COLUMN resolved_by_account_id bigint,
    ADD CONSTRAINT age_appeal_resolution_decision_check CHECK (
        resolution_decision IS NULL OR resolution_decision IN (
            'APPROVE_ADULT', 'DENY_MINOR', 'REVERIFY', 'SUSPEND')),
    ADD CONSTRAINT age_appeal_resolution_shape CHECK (
        (status = 'SUBMITTED' AND resolution_decision IS NULL
            AND resolved_by_account_id IS NULL AND resolved_at IS NULL)
        OR (status = 'RESOLVED' AND resolution_decision IS NOT NULL
            AND resolved_by_account_id IS NOT NULL AND resolved_at IS NOT NULL));

CREATE FUNCTION vc.resolve_age_appeal(
    p_acting_account_id bigint,
    p_appeal_id bigint,
    p_decision text,
    p_resolution_note text
)
    RETURNS TABLE(
        out_appeal_id bigint,
        out_decision text,
        out_age_state text,
        out_resolved_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_owner bigint;
    v_status text;
    v_current_state text;
    v_next_state text;
    v_note text := left(btrim(COALESCE(p_resolution_note, '')), 240);
    v_resolved_at timestamptz := clock_timestamp();
    v_case_id bigint;
    v_case_status text;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0
       OR p_appeal_id IS NULL OR p_appeal_id <= 0 THEN
        RAISE EXCEPTION 'resolve_age_appeal: actor and appeal are required';
    END IF;
    SELECT a.role INTO v_role FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role NOT IN ('ADMIN', 'PRIVACY_OPERATOR') THEN
        RAISE EXCEPTION 'resolve_age_appeal: mutation denied';
    END IF;
    IF p_decision IS NULL
       OR p_decision NOT IN ('APPROVE_ADULT', 'DENY_MINOR', 'REVERIFY', 'SUSPEND') THEN
        RAISE EXCEPTION 'resolve_age_appeal: unsupported decision';
    END IF;
    IF v_note = '' THEN
        RAISE EXCEPTION 'resolve_age_appeal: resolution note is required';
    END IF;

    SELECT a.owner_user_id, a.status INTO v_owner, v_status
      FROM vc.age_appeal a WHERE a.id = p_appeal_id FOR UPDATE;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'resolve_age_appeal: appeal not found';
    END IF;
    IF v_status <> 'SUBMITTED' THEN
        RAISE EXCEPTION 'resolve_age_appeal: appeal is already resolved';
    END IF;
    SELECT v.age_state INTO v_current_state FROM vc.age_verification v
     WHERE v.owner_user_id = v_owner ORDER BY v.id DESC LIMIT 1;
    IF v_current_state IS DISTINCT FROM 'AGE_APPEAL_PENDING' THEN
        RAISE EXCEPTION 'resolve_age_appeal: owner is not appeal-pending';
    END IF;

    v_next_state := CASE p_decision
        WHEN 'APPROVE_ADULT' THEN 'ADULT_VERIFIED'
        WHEN 'DENY_MINOR' THEN 'MINOR_VERIFIED'
        WHEN 'REVERIFY' THEN 'AGE_REVERIFY_REQUIRED'
        WHEN 'SUSPEND' THEN 'AGE_ACCESS_SUSPENDED'
    END;

    UPDATE vc.age_appeal
       SET status = 'RESOLVED',
           resolution_note = v_note,
           resolution_decision = p_decision,
           resolved_by_account_id = p_acting_account_id,
           resolved_at = v_resolved_at
     WHERE owner_user_id = v_owner AND id = p_appeal_id;
    INSERT INTO vc.age_verification(owner_user_id, id, age_state, provider_ref, verified_at)
    VALUES (v_owner, nextval('vc.age_verification_id_seq'), v_next_state,
            'operator-appeal-review', v_resolved_at);

    SELECT c.id, c.status INTO v_case_id, v_case_status
      FROM vc.ops_case c
     WHERE c.kind = 'AGE_APPEAL'
       AND c.source_owner_user_id = v_owner
       AND c.source_id = p_appeal_id
     FOR UPDATE;
    IF v_case_id IS NOT NULL AND v_case_status <> 'RESOLVED' THEN
        UPDATE vc.ops_case
           SET status = 'RESOLVED', disposition_reason = v_note, updated_at = v_resolved_at
         WHERE id = v_case_id;
        INSERT INTO vc.ops_case_event(
            case_id, event_type, from_status, to_status, actor_account_id)
        VALUES (v_case_id, 'RESOLVE', v_case_status, 'RESOLVED', p_acting_account_id);
    END IF;

    RETURN QUERY SELECT p_appeal_id, p_decision, v_next_state, v_resolved_at;
END;
$$;

REVOKE ALL ON FUNCTION vc.resolve_age_appeal(bigint, bigint, text, text)
    FROM PUBLIC, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT EXECUTE ON FUNCTION vc.resolve_age_appeal(bigint, bigint, text, text) TO vc_api;
