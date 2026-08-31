-- S0-04: owner-scoped account status read for the generation admission gate.
-- The caller may only read their own row; missing/foreign ids fail closed
-- without disclosing existence. Runtime roles have EXECUTE only.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.identity_account_status(p_account_id bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_account_id IS NULL OR p_account_id <= 0 THEN
        RAISE EXCEPTION 'identity_account_status: account_id is required';
    END IF;
    IF p_account_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'identity_account_status: account_id must match server-trusted context';
    END IF;
    SELECT a.status INTO v_status
      FROM vc.identity_account a
     WHERE a.id = p_account_id;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'identity_account_status: account not found';
    END IF;
    RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION vc.identity_account_status(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.identity_account_status(bigint) TO vc_api;
