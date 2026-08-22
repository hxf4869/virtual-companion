-- S0-24-A: versioned release gate. SYNTHETIC is the shipped stage.
-- CANARY/BETA cannot enable without eval_passed (Owner thresholds). Runtime
-- roles never take table DML.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.release_gate (
    id              integer PRIMARY KEY CHECK (id = 1),
    stage           text NOT NULL,
    policy_version  text NOT NULL,
    eval_passed     boolean NOT NULL DEFAULT false,
    CONSTRAINT release_gate_stage CHECK (stage IN ('SYNTHETIC', 'CANARY', 'BETA')),
    CONSTRAINT release_gate_policy CHECK (char_length(policy_version) BETWEEN 1 AND 64)
);

INSERT INTO vc.release_gate(id, stage, policy_version, eval_passed)
VALUES (1, 'SYNTHETIC', 'synthetic-v1', false);

REVOKE ALL ON vc.release_gate FROM PUBLIC;
GRANT SELECT ON vc.release_gate
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.release_gate_snapshot()
    RETURNS TABLE(out_stage text, out_eval_passed boolean, out_policy_version text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    RETURN QUERY
    SELECT g.stage, g.eval_passed, g.policy_version
      FROM vc.release_gate g
     WHERE g.id = 1;
END;
$$;

CREATE FUNCTION vc.advance_release_gate(
    p_stage        text,
    p_eval_passed  boolean,
    p_policy_version text
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
    IF p_stage IN ('CANARY', 'BETA') AND p_eval_passed IS NOT TRUE THEN
        RAISE EXCEPTION 'advance_release_gate: CANARY/BETA require eval_passed';
    END IF;
    UPDATE vc.release_gate
       SET stage = p_stage,
           eval_passed = COALESCE(p_eval_passed, false),
           policy_version = btrim(p_policy_version)
     WHERE id = 1;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vc.release_gate_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.advance_release_gate(text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.release_gate_snapshot()
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.advance_release_gate(text, boolean, text)
    TO vc_api;
