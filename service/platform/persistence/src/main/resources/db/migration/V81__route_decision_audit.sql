-- S0-11-B: immutable route-decision audit on vc.generation_route.
--
-- The V2 generation_route skeleton only stored an integer decision_no and a
-- provider_ref. Runtime never wrote it (V16 revoked direct DML). This
-- migration adds the reconstructable audit columns and an insert-only
-- SECURITY DEFINER writer so every LiveModelInvoker.prepare decision can be
-- replayed: candidates, entitled vs actual service class, policy version,
-- outcome reason, selected deployment or ZERO_LLM/NONE fallback.
--
-- Rows are append-only. The same (owner, decision_ref) is idempotent when the
-- payload matches and fail-closed when it differs.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.generation_route
    ADD COLUMN IF NOT EXISTS decision_ref text,
    ADD COLUMN IF NOT EXISTS status text,
    ADD COLUMN IF NOT EXISTS policy_version text,
    ADD COLUMN IF NOT EXISTS entitled_service_class text,
    ADD COLUMN IF NOT EXISTS actual_service_class text,
    ADD COLUMN IF NOT EXISTS outcome_reason text,
    ADD COLUMN IF NOT EXISTS selected_provider_id text,
    ADD COLUMN IF NOT EXISTS considered_candidates text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE vc.generation_route
    DROP CONSTRAINT IF EXISTS generation_route_status_check;
ALTER TABLE vc.generation_route
    ADD CONSTRAINT generation_route_status_check CHECK (
        status IS NULL OR status IN ('SELECTED', 'NO_ELIGIBLE_DEPLOYMENT')
    );

CREATE UNIQUE INDEX IF NOT EXISTS generation_route_decision_ref_uniq
    ON vc.generation_route (owner_user_id, decision_ref)
    WHERE decision_ref IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS vc.generation_route_id_seq AS bigint;

CREATE FUNCTION vc.record_route_decision(
    p_owner_user_id          bigint,
    p_generation_id          bigint,
    p_decision_ref           text,
    p_status                 text,
    p_policy_version         text,
    p_entitled_service_class text,
    p_actual_service_class   text,
    p_outcome_reason         text,
    p_selected_provider_id   text,
    p_considered_candidates  text[]
)
    RETURNS TABLE(out_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_existing vc.generation_route%ROWTYPE;
    v_candidates text[] := COALESCE(p_considered_candidates, ARRAY[]::text[]);
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_route_decision: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'record_route_decision: generation_id is required';
    END IF;
    IF p_decision_ref IS NULL OR btrim(p_decision_ref) = '' THEN
        RAISE EXCEPTION 'record_route_decision: decision_ref is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('SELECTED', 'NO_ELIGIBLE_DEPLOYMENT') THEN
        RAISE EXCEPTION 'record_route_decision: unsupported status %', p_status;
    END IF;
    IF p_policy_version IS NULL OR btrim(p_policy_version) = '' THEN
        RAISE EXCEPTION 'record_route_decision: policy_version is required';
    END IF;
    IF p_entitled_service_class IS NULL OR btrim(p_entitled_service_class) = '' THEN
        RAISE EXCEPTION 'record_route_decision: entitled_service_class is required';
    END IF;
    IF p_actual_service_class IS NULL OR btrim(p_actual_service_class) = '' THEN
        RAISE EXCEPTION 'record_route_decision: actual_service_class is required';
    END IF;
    IF p_outcome_reason IS NULL OR btrim(p_outcome_reason) = '' THEN
        RAISE EXCEPTION 'record_route_decision: outcome_reason is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_route_decision: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1 FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'record_route_decision: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    SELECT * INTO v_existing
      FROM vc.generation_route r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.decision_ref = p_decision_ref;
    IF FOUND THEN
        IF v_existing.generation_id IS DISTINCT FROM p_generation_id
           OR v_existing.status IS DISTINCT FROM p_status
           OR v_existing.policy_version IS DISTINCT FROM p_policy_version
           OR v_existing.entitled_service_class IS DISTINCT FROM p_entitled_service_class
           OR v_existing.actual_service_class IS DISTINCT FROM p_actual_service_class
           OR v_existing.outcome_reason IS DISTINCT FROM p_outcome_reason
           OR v_existing.selected_provider_id IS DISTINCT FROM p_selected_provider_id
           OR v_existing.considered_candidates IS DISTINCT FROM v_candidates THEN
            RAISE EXCEPTION 'record_route_decision: immutable payload mismatch for %',
                p_decision_ref;
        END IF;
        RETURN QUERY SELECT v_existing.id;
        RETURN;
    END IF;

    v_id := nextval('vc.generation_route_id_seq');
    INSERT INTO vc.generation_route(
        owner_user_id, id, generation_id, decision_no, provider_ref,
        decision_ref, status, policy_version, entitled_service_class,
        actual_service_class, outcome_reason, selected_provider_id,
        considered_candidates)
    VALUES (
        p_owner_user_id, v_id, p_generation_id, 0,
        COALESCE(p_selected_provider_id, p_actual_service_class),
        p_decision_ref, p_status, p_policy_version, p_entitled_service_class,
        p_actual_service_class, p_outcome_reason, p_selected_provider_id,
        v_candidates);

    RETURN QUERY SELECT v_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.record_route_decision(
    bigint, bigint, text, text, text, text, text, text, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_route_decision(
    bigint, bigint, text, text, text, text, text, text, text, text[]) TO vc_api;
