-- S0-14-D: redacted ops-case list for the operator UI. Same columns as
-- snapshot (no internal_note, no chat body). Kind filter follows RBAC.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.list_ops_cases(
    p_acting_account_id bigint,
    p_after             bigint,
    p_limit             integer
)
    RETURNS TABLE(
        out_id bigint,
        out_kind text,
        out_source_owner_user_id bigint,
        out_source_id bigint,
        out_status text,
        out_severity text,
        out_sla_hours integer,
        out_assignee_account_id bigint,
        out_disposition_reason text,
        out_public_note text,
        out_opened_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_limit integer;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'list_ops_cases: acting account is required';
    END IF;
    SELECT a.role INTO v_role
      FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role = 'USER' THEN
        RAISE EXCEPTION 'list_ops_cases: caller is not an active operator';
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
    RETURN QUERY
    SELECT c.id, c.kind, c.source_owner_user_id, c.source_id, c.status, c.severity,
           c.sla_hours, c.assignee_account_id, c.disposition_reason, c.public_note,
           c.opened_at
      FROM vc.ops_case c
     WHERE vc.ops_case_kind_permitted(v_role, c.kind)
       AND (p_after IS NULL OR p_after <= 0 OR c.id < p_after)
     ORDER BY c.id DESC
     LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION vc.list_ops_cases(bigint, bigint, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_ops_cases(bigint, bigint, integer) TO vc_api;
