-- S0-24-B2 V97: immutable provider/model/prompt/persona/config/release bundle.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.attempt_intent
    ADD COLUMN model_id text,
    ADD COLUMN model_revision text,
    ADD COLUMN prompt_bundle_version text,
    ADD COLUMN persona_bundle_version text,
    ADD COLUMN config_version text,
    ADD COLUMN release_stage text,
    ADD COLUMN release_policy_version text,
    ADD CONSTRAINT attempt_intent_release_bundle_shape_check CHECK (
        (model_id IS NULL
         AND model_revision IS NULL
         AND prompt_bundle_version IS NULL
         AND persona_bundle_version IS NULL
         AND config_version IS NULL
         AND release_stage IS NULL
         AND release_policy_version IS NULL)
        OR
        (model_id IS NOT NULL AND btrim(model_id) <> ''
         AND model_revision IS NOT NULL AND btrim(model_revision) <> ''
         AND prompt_bundle_version IS NOT NULL AND btrim(prompt_bundle_version) <> ''
         AND persona_bundle_version IS NOT NULL AND btrim(persona_bundle_version) <> ''
         AND config_version IS NOT NULL AND btrim(config_version) <> ''
         AND release_stage IN ('CANARY', 'BETA')
         AND release_policy_version IS NOT NULL AND btrim(release_policy_version) <> ''));

CREATE FUNCTION vc.attempt_intent_release_bundle_immutable()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF NEW.provider_attempt_id IS DISTINCT FROM OLD.provider_attempt_id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.supplier_name IS DISTINCT FROM OLD.supplier_name
       OR NEW.model_id IS DISTINCT FROM OLD.model_id
       OR NEW.model_revision IS DISTINCT FROM OLD.model_revision
       OR NEW.prompt_bundle_version IS DISTINCT FROM OLD.prompt_bundle_version
       OR NEW.persona_bundle_version IS DISTINCT FROM OLD.persona_bundle_version
       OR NEW.config_version IS DISTINCT FROM OLD.config_version
       OR NEW.release_stage IS DISTINCT FROM OLD.release_stage
       OR NEW.release_policy_version IS DISTINCT FROM OLD.release_policy_version THEN
        RAISE EXCEPTION 'attempt_intent release bundle and provider identity are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER attempt_intent_release_bundle_immutable
    BEFORE UPDATE ON vc.attempt_intent
    FOR EACH ROW
    EXECUTE FUNCTION vc.attempt_intent_release_bundle_immutable();

-- The pre-V97 entry point must never create a new unversioned attempt.
CREATE OR REPLACE FUNCTION vc.create_attempt_intent(
    p_owner_user_id                    bigint,
    p_work_item_id                     bigint,
    p_generation_id                    bigint,
    p_claim_token_hash                 text,
    p_claim_fence_hash                 text,
    p_provider_attempt_id              text,
    p_provider_id                      text,
    p_supplier_name                    text,
    p_requested_authorization_snapshot text,
    p_execution_authorization_snapshot text)
    RETURNS TABLE(out_id bigint, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RAISE EXCEPTION 'create_attempt_intent: immutable release bundle required';
END;
$$;

CREATE FUNCTION vc.create_attempt_intent(
    p_owner_user_id                    bigint,
    p_work_item_id                     bigint,
    p_generation_id                    bigint,
    p_claim_token_hash                 text,
    p_claim_fence_hash                 text,
    p_provider_attempt_id              text,
    p_provider_id                      text,
    p_supplier_name                    text,
    p_requested_authorization_snapshot text,
    p_execution_authorization_snapshot text,
    p_model_id                         text,
    p_model_revision                   text,
    p_prompt_bundle_version            text,
    p_persona_bundle_version           text,
    p_config_version                   text)
    RETURNS TABLE(out_id bigint, out_provider_attempt_id text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_release_stage text;
    v_eval_passed boolean;
    v_release_policy_version text;
    v_canary_owner_user_id bigint;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_work_item_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'create_attempt_intent: work_item_id and generation_id are required';
    END IF;
    IF p_claim_token_hash IS NULL OR btrim(p_claim_token_hash) = ''
       OR p_claim_fence_hash IS NULL OR btrim(p_claim_fence_hash) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: claim token/fence hashes are required';
    END IF;
    IF p_provider_attempt_id IS NULL OR btrim(p_provider_attempt_id) = ''
       OR p_provider_id IS NULL OR btrim(p_provider_id) = ''
       OR p_supplier_name IS NULL OR btrim(p_supplier_name) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: provider identity is required';
    END IF;
    IF p_requested_authorization_snapshot IS NULL OR btrim(p_requested_authorization_snapshot) = ''
       OR p_execution_authorization_snapshot IS NULL OR btrim(p_execution_authorization_snapshot) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: authorization snapshots are required';
    END IF;
    IF p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_revision IS NULL OR btrim(p_model_revision) = ''
       OR p_prompt_bundle_version IS NULL OR btrim(p_prompt_bundle_version) = ''
       OR p_persona_bundle_version IS NULL OR btrim(p_persona_bundle_version) = ''
       OR p_config_version IS NULL OR btrim(p_config_version) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: complete immutable release bundle is required';
    END IF;

    PERFORM 1 FROM vc.work_item wi
     WHERE wi.owner_user_id = p_owner_user_id
       AND wi.id = p_work_item_id
       AND wi.status = 'CLAIMED'
       AND encode(digest(wi.claim_token, 'sha256'), 'hex') = p_claim_token_hash
       AND encode(digest(wi.claim_fence, 'sha256'), 'hex') = p_claim_fence_hash
       AND wi.lease_expires_at > clock_timestamp();
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_attempt_intent: work item % has no live claim matching the presented token/fence (missing, overtaken or lease expired)',
            p_work_item_id;
    END IF;

    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'create_attempt_intent: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    SELECT g.stage, g.eval_passed, g.policy_version, g.canary_owner_user_id
      INTO v_release_stage, v_eval_passed, v_release_policy_version, v_canary_owner_user_id
      FROM vc.release_gate g
     WHERE g.id = 1
     FOR SHARE;
    IF NOT FOUND OR v_release_policy_version IS NULL OR btrim(v_release_policy_version) = '' THEN
        RAISE EXCEPTION 'create_attempt_intent: release gate and policy are required';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.identity_account a
         WHERE a.id = p_owner_user_id AND a.role = 'USER' AND a.status = 'ACTIVE') THEN
        RAISE EXCEPTION 'create_attempt_intent: owner must remain an ACTIVE USER';
    END IF;
    IF v_release_stage = 'CANARY' THEN
        IF v_eval_passed IS NOT TRUE
           OR v_canary_owner_user_id IS DISTINCT FROM p_owner_user_id THEN
            RAISE EXCEPTION 'create_attempt_intent: owner is not the active CANARY owner';
        END IF;
    ELSIF v_release_stage = 'BETA' THEN
        IF v_eval_passed IS NOT TRUE THEN
            RAISE EXCEPTION 'create_attempt_intent: BETA evaluation is not passed';
        END IF;
    ELSE
        RAISE EXCEPTION 'create_attempt_intent: release stage forbids provider attempts';
    END IF;

    v_id := nextval('vc.attempt_intent_id_seq');
    INSERT INTO vc.attempt_intent(
        owner_user_id, id, work_item_id, generation_id, provider_attempt_id,
        provider_id, supplier_name, status,
        claim_token_hash, claim_fence_hash,
        requested_authorization_snapshot, execution_authorization_snapshot,
        attempt_started_at,
        model_id, model_revision, prompt_bundle_version, persona_bundle_version,
        config_version, release_stage, release_policy_version)
    VALUES (
        p_owner_user_id, v_id, p_work_item_id, p_generation_id, p_provider_attempt_id,
        p_provider_id, p_supplier_name, 'CREATED',
        p_claim_token_hash, p_claim_fence_hash,
        p_requested_authorization_snapshot, p_execution_authorization_snapshot,
        clock_timestamp(),
        btrim(p_model_id), btrim(p_model_revision), btrim(p_prompt_bundle_version),
        btrim(p_persona_bundle_version), btrim(p_config_version),
        v_release_stage, btrim(v_release_policy_version));

    RETURN QUERY SELECT v_id, p_provider_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text)
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE EXECUTE ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text,
                             text, text, text, text, text)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.create_attempt_intent(bigint, bigint, bigint, text, text, text, text, text, text, text,
                             text, text, text, text, text)
    TO vc_api, vc_worker;

REVOKE ALL ON FUNCTION vc.attempt_intent_release_bundle_immutable()
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

DO $$
BEGIN
    IF has_function_privilege('public',
        'vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text,text,text,text,text,text)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'V97: versioned create_attempt_intent must not be PUBLIC executable';
    END IF;
    IF has_function_privilege('vc_api',
        'vc.create_attempt_intent(bigint,bigint,bigint,text,text,text,text,text,text,text)',
        'EXECUTE') THEN
        RAISE EXCEPTION 'V97: legacy create_attempt_intent must not be runtime executable';
    END IF;
END;
$$;
