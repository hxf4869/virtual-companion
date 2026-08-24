-- Bind the single CANARY owner to the versioned release-gate row. The owner
-- deliberately has no foreign key: account deletion and test-suite TRUNCATE
-- operations must remain possible, while a stale/missing account fails closed
-- when the runtime evaluates the snapshot.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.release_gate
    ADD COLUMN canary_owner_user_id bigint;

ALTER TABLE vc.release_gate
    ADD CONSTRAINT release_gate_eval_state CHECK (
        (stage = 'SYNTHETIC' AND eval_passed IS FALSE)
        OR (stage IN ('CANARY', 'BETA') AND eval_passed IS TRUE)
    ),
    ADD CONSTRAINT release_gate_canary_owner_state CHECK (
        (stage = 'CANARY' AND canary_owner_user_id IS NOT NULL)
        OR (stage <> 'CANARY' AND canary_owner_user_id IS NULL)
    );

REVOKE ALL ON TABLE vc.release_gate
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

DROP FUNCTION vc.release_gate_snapshot();
DROP FUNCTION vc.advance_release_gate(text, boolean, text);

CREATE FUNCTION vc.release_gate_snapshot()
    RETURNS TABLE(
        out_stage text,
        out_eval_passed boolean,
        out_policy_version text,
        out_canary_owner_user_id bigint
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT g.stage, g.eval_passed, g.policy_version, g.canary_owner_user_id
      FROM vc.release_gate g
     WHERE g.id = 1;
END;
$$;

CREATE FUNCTION vc.advance_release_gate(
    p_stage text,
    p_eval_passed boolean,
    p_policy_version text,
    p_canary_owner_user_id bigint DEFAULT NULL
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_stage IS NULL OR p_stage NOT IN ('SYNTHETIC', 'CANARY', 'BETA') THEN
        RAISE EXCEPTION 'advance_release_gate: unsupported stage';
    END IF;
    IF p_policy_version IS NULL OR btrim(p_policy_version) = '' THEN
        RAISE EXCEPTION 'advance_release_gate: policy_version is required';
    END IF;
    IF p_stage = 'SYNTHETIC' AND p_eval_passed IS NOT FALSE THEN
        RAISE EXCEPTION 'advance_release_gate: SYNTHETIC requires eval_passed=false';
    END IF;
    IF p_stage IN ('CANARY', 'BETA') AND p_eval_passed IS NOT TRUE THEN
        RAISE EXCEPTION 'advance_release_gate: CANARY/BETA require eval_passed=true';
    END IF;
    IF p_stage = 'CANARY' THEN
        IF p_canary_owner_user_id IS NULL OR NOT EXISTS (
            SELECT 1
              FROM vc.identity_account a
             WHERE a.id = p_canary_owner_user_id
               AND a.role = 'USER'
               AND a.status = 'ACTIVE'
        ) THEN
            RAISE EXCEPTION 'advance_release_gate: CANARY owner must be an ACTIVE USER';
        END IF;
    ELSIF p_canary_owner_user_id IS NOT NULL THEN
        RAISE EXCEPTION 'advance_release_gate: canary owner is only valid for CANARY';
    END IF;

    UPDATE vc.release_gate
       SET stage = p_stage,
           eval_passed = p_eval_passed,
           policy_version = btrim(p_policy_version),
           canary_owner_user_id = p_canary_owner_user_id
     WHERE id = 1;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vc.release_gate_snapshot()
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE ALL ON FUNCTION vc.advance_release_gate(text, boolean, text, bigint)
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

GRANT EXECUTE ON FUNCTION vc.release_gate_snapshot() TO vc_api;
