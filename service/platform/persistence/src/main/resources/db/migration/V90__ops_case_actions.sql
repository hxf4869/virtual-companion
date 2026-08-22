-- S0-14-C: assign/ack/escalate/resolve. OPS_VIEWER cannot mutate. Disposition
-- reason is required to RESOLVE. No hotline or SLA promise is invented.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.transition_ops_case(
    p_acting_account_id bigint,
    p_case_id           bigint,
    p_action            text,
    p_assignee_account_id bigint,
    p_disposition_reason  text
)
    RETURNS TABLE(out_id bigint, out_status text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_kind text;
    v_status text;
    v_next text;
    v_reason text := left(btrim(COALESCE(p_disposition_reason, '')), 240);
    v_event text;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'transition_ops_case: acting account is required';
    END IF;
    SELECT a.role INTO v_role
      FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role IN ('USER', 'OPS_VIEWER') THEN
        RAISE EXCEPTION 'transition_ops_case: mutation denied';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('ACK', 'ASSIGN', 'ESCALATE', 'RESOLVE') THEN
        RAISE EXCEPTION 'transition_ops_case: unsupported action';
    END IF;
    SELECT c.kind, c.status INTO v_kind, v_status
      FROM vc.ops_case c WHERE c.id = p_case_id FOR UPDATE;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'transition_ops_case: case not found';
    END IF;
    IF NOT vc.ops_case_kind_permitted(v_role, v_kind) THEN
        RAISE EXCEPTION 'transition_ops_case: kind not permitted for role';
    END IF;
    IF v_status = 'RESOLVED' THEN
        RAISE EXCEPTION 'transition_ops_case: case is already resolved';
    END IF;

    IF p_action = 'ACK' THEN
        v_next := 'ACKNOWLEDGED';
        v_event := 'ACK';
    ELSIF p_action = 'ASSIGN' THEN
        IF p_assignee_account_id IS NULL OR p_assignee_account_id <= 0 THEN
            RAISE EXCEPTION 'transition_ops_case: assignee is required';
        END IF;
        v_next := 'ASSIGNED';
        v_event := 'ASSIGN';
    ELSIF p_action = 'ESCALATE' THEN
        v_next := 'ESCALATED';
        v_event := 'ESCALATE';
    ELSE
        IF v_reason = '' THEN
            RAISE EXCEPTION 'transition_ops_case: disposition_reason is required';
        END IF;
        v_next := 'RESOLVED';
        v_event := 'RESOLVE';
    END IF;

    UPDATE vc.ops_case
       SET status = v_next,
           assignee_account_id = CASE WHEN p_action = 'ASSIGN'
                                      THEN p_assignee_account_id
                                      ELSE assignee_account_id END,
           disposition_reason = CASE WHEN p_action = 'RESOLVE'
                                     THEN v_reason
                                     ELSE disposition_reason END,
           updated_at = now()
     WHERE id = p_case_id;

    INSERT INTO vc.ops_case_event(case_id, event_type, from_status, to_status, actor_account_id)
    VALUES (p_case_id, v_event, v_status, v_next, p_acting_account_id);

    RETURN QUERY SELECT p_case_id, v_next;
END;
$$;

REVOKE ALL ON FUNCTION vc.transition_ops_case(bigint, bigint, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.transition_ops_case(bigint, bigint, text, bigint, text) TO vc_api;
