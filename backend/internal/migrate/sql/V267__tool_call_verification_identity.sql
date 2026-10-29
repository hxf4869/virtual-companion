-- A tool-call probe can outlive the row it read. VERIFIED is written only when
-- the provider protocol, base URL, model id, and provider revision still match
-- the values that were probed. A mismatch leaves the capability bits untouched.

SET search_path TO vc, pg_catalog;

DROP FUNCTION vc.go_admin_mark_model_tool_calls_verified(bigint, text, text);

CREATE FUNCTION vc.go_admin_mark_model_tool_calls_verified(
    p_acting_account_id bigint,
    p_provider_id text,
    p_profile_key text,
    p_protocol text,
    p_base_url text,
    p_model_id text,
    p_revision bigint)
    RETURNS TABLE(out_verified_at timestamptz, out_protocol text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_protocol text;
    v_base_url text;
    v_model_id text;
    v_revision bigint;
    v_at timestamptz;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_acting_account_id);
    SELECT p.protocol, p.base_url, m.model_id, p.revision
      INTO v_protocol, v_base_url, v_model_id, v_revision
      FROM vc.provider_config p
      JOIN vc.provider_model m ON m.provider_id = p.provider_id
     WHERE p.provider_id = btrim(p_provider_id)
       AND m.profile_key = btrim(p_profile_key)
     FOR UPDATE OF p, m;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_admin_provider_model: profile not found';
    END IF;
    IF v_protocol IS DISTINCT FROM p_protocol
       OR v_base_url IS DISTINCT FROM p_base_url
       OR v_model_id IS DISTINCT FROM p_model_id
       OR v_revision IS DISTINCT FROM p_revision THEN
        RAISE EXCEPTION 'tool call verification identity changed';
    END IF;
    v_at := clock_timestamp();
    UPDATE vc.provider_model m
       SET capabilities = jsonb_set(COALESCE(m.capabilities, '{}'::jsonb), '{toolCalls}', '"VERIFIED"', true),
           tool_calls_verified_at = v_at,
           tool_calls_verified_protocol = v_protocol,
           tool_calls_verified_base_url = v_base_url,
           tool_calls_verified_model_id = v_model_id,
           updated_by = p_acting_account_id,
           updated_at = now()
     WHERE m.provider_id = btrim(p_provider_id)
       AND m.profile_key = btrim(p_profile_key)
       AND m.model_id = p_model_id
       AND EXISTS (
           SELECT 1 FROM vc.provider_config p
            WHERE p.provider_id = m.provider_id
              AND p.protocol = p_protocol
              AND p.base_url = p_base_url
              AND p.revision = p_revision);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'tool call verification identity changed';
    END IF;
    RETURN QUERY SELECT v_at, v_protocol;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_admin_mark_model_tool_calls_verified(bigint, text, text, text, text, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_admin_mark_model_tool_calls_verified(bigint, text, text, text, text, text, bigint) TO vc_api;
