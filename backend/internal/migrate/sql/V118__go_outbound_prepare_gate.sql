-- G12: make the Go attempt intent the linearization point for current
-- authorization and provider admission. Historical functions stay intact;
-- the runtime roles may create a Go attempt only through the checked wrapper.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.go_lock_outbound_owner(p_owner_user_id bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner_user_id);
    PERFORM 1
      FROM vc.vc_user u
     WHERE u.id = p_owner_user_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'go_lock_outbound_owner: owner not found';
    END IF;
END;
$$;

CREATE FUNCTION vc.go_prepare_model_attempt(
    p_owner_user_id bigint,
    p_work_item_id bigint,
    p_generation_id bigint,
    p_claim_token text,
    p_claim_fence text,
    p_provider_id text,
    p_supplier_name text,
    p_model_id text,
    p_effective_categories text[],
    p_consent_version text,
    p_provider_contract_version text,
    p_prompt_version text,
    p_persona_version text,
    p_config_version text,
    p_reserved_cost bigint,
    p_hard_limit bigint)
    RETURNS TABLE(out_attempt_id bigint, out_attempt_no integer, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_admission text;
    v_protocol text;
BEGIN
    -- Consent writes and deletion requests in the Go store take this same
    -- owner-row lock. Whichever transaction commits first defines whether
    -- this attempt was authorized; no connection is held across provider I/O.
    PERFORM vc.go_lock_outbound_owner(p_owner_user_id);

    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'go_prepare_model_attempt: outbound is not currently authorized';
    END IF;

    IF EXISTS (
        WITH required(consent_type) AS (
            VALUES ('SERVICE_TERMS'),
                   ('PRIVACY_POLICY'),
                   ('AI_CONTENT_NOTICE'),
                   ('THIRD_PARTY_MODEL_PROCESSING'),
                   ('SENSITIVE_DATA_PROCESSING')
        )
        SELECT 1
          FROM required r
          LEFT JOIN LATERAL (
              SELECT c.granted
                FROM vc.consent_record c
               WHERE c.owner_user_id = p_owner_user_id
                 AND c.consent_type = r.consent_type
               ORDER BY c.id DESC
               LIMIT 1
          ) latest ON true
         WHERE latest.granted IS DISTINCT FROM true
    ) THEN
        RAISE EXCEPTION 'go_prepare_model_attempt: outbound is not currently authorized';
    END IF;

    SELECT d.admission_state, d.protocol
      INTO v_admission, v_protocol
      FROM vc.provider_deployment d
     WHERE d.provider_id = p_provider_id
     FOR SHARE;
    IF NOT FOUND OR v_admission IS DISTINCT FROM 'ADMITTED'
       OR v_protocol IS DISTINCT FROM 'OPENAI_CHAT_COMPLETIONS' THEN
        RAISE EXCEPTION 'go_prepare_model_attempt: provider is not currently admitted';
    END IF;

    RETURN QUERY
        SELECT a.out_attempt_id, a.out_attempt_no, a.out_provider_attempt_id
          FROM vc.go_create_model_attempt(
              p_owner_user_id, p_work_item_id, p_generation_id,
              p_claim_token, p_claim_fence, p_provider_id, p_supplier_name,
              p_model_id, p_effective_categories, p_consent_version,
              p_provider_contract_version, p_prompt_version, p_persona_version,
              p_config_version, p_reserved_cost, p_hard_limit) a;
END;
$$;

REVOKE ALL ON FUNCTION vc.go_lock_outbound_owner(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_lock_outbound_owner(bigint) TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.go_prepare_model_attempt(bigint, bigint, bigint, text, text, text, text, text, text[], text, text, text, text, text, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_prepare_model_attempt(bigint, bigint, bigint, text, text, text, text, text, text[], text, text, text, text, text, bigint, bigint)
    TO vc_api, vc_worker;

REVOKE EXECUTE ON FUNCTION vc.go_create_model_attempt(bigint, bigint, bigint, text, text, text, text, text, text[], text, text, text, text, text, bigint, bigint)
    FROM vc_api, vc_worker;
