-- S0-24-C: durable provider rollback and sanitized rollback history.
-- Runtime roles cannot mutate provider_deployment directly. The narrow
-- SECURITY DEFINER function atomically disables one deployment and records
-- only fixed codes, state, time, and whether the state changed.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE vc.provider_rollback_history_id_seq AS bigint;

CREATE TABLE vc.provider_rollback_history (
    id                       bigint PRIMARY KEY
                                 DEFAULT nextval('vc.provider_rollback_history_id_seq'),
    provider_id              text NOT NULL,
    trigger_code             text NOT NULL,
    actor_code               text NOT NULL,
    previous_admission_state text NOT NULL,
    changed                  boolean NOT NULL,
    rolled_back_at           timestamptz NOT NULL,
    CONSTRAINT provider_rollback_history_trigger CHECK (
        trigger_code IN (
            'CONSECUTIVE_FAILURES', 'SAFETY_LEAK', 'BILLING_DRIFT', 'OPERATOR')),
    CONSTRAINT provider_rollback_history_actor CHECK (
        actor_code IN ('AUTO', 'OPERATOR')),
    CONSTRAINT provider_rollback_history_previous_state CHECK (
        previous_admission_state IN ('ADMITTED', 'DISABLED', 'REJECTED')),
    CONSTRAINT provider_rollback_history_actor_trigger CHECK (
        (trigger_code = 'CONSECUTIVE_FAILURES' AND actor_code = 'AUTO')
        OR (trigger_code IN ('SAFETY_LEAK', 'OPERATOR') AND actor_code = 'OPERATOR')
        OR trigger_code = 'BILLING_DRIFT')
);

CREATE INDEX provider_rollback_history_provider_recent_idx
    ON vc.provider_rollback_history (provider_id, rolled_back_at DESC, id DESC);

-- V4 originally allowed the coordinator to maintain provider_deployment
-- directly. Durable rollback closes that exception: every runtime write is now
-- mediated by a SECURITY DEFINER function.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
    ON TABLE vc.provider_deployment
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

REVOKE ALL ON TABLE vc.provider_rollback_history
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
REVOKE ALL ON SEQUENCE vc.provider_rollback_history_id_seq
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.rollback_provider_deployment(
    p_provider_id  text,
    p_trigger_code text,
    p_actor_code   text
)
    RETURNS TABLE(
        out_history_id bigint,
        out_previous_admission_state text,
        out_changed boolean,
        out_rolled_back_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_provider_id text;
    v_previous_admission_state text;
    v_changed boolean;
    v_history_id bigint;
    v_rolled_back_at timestamptz;
BEGIN
    v_provider_id := btrim(p_provider_id);
    IF v_provider_id IS NULL OR v_provider_id = '' THEN
        RAISE EXCEPTION 'rollback_provider_deployment: provider is required';
    END IF;
    IF p_trigger_code IS NULL OR p_trigger_code NOT IN (
            'CONSECUTIVE_FAILURES', 'SAFETY_LEAK', 'BILLING_DRIFT', 'OPERATOR') THEN
        RAISE EXCEPTION 'rollback_provider_deployment: unsupported trigger code';
    END IF;
    IF p_actor_code IS NULL OR p_actor_code NOT IN ('AUTO', 'OPERATOR') THEN
        RAISE EXCEPTION 'rollback_provider_deployment: unsupported actor code';
    END IF;
    IF (p_trigger_code = 'CONSECUTIVE_FAILURES' AND p_actor_code <> 'AUTO')
       OR (p_trigger_code IN ('SAFETY_LEAK', 'OPERATOR') AND p_actor_code <> 'OPERATOR') THEN
        RAISE EXCEPTION 'rollback_provider_deployment: trigger/actor combination is not allowed';
    END IF;

    SELECT d.admission_state
      INTO v_previous_admission_state
      FROM vc.provider_deployment d
     WHERE d.provider_id = v_provider_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'rollback_provider_deployment: provider unavailable';
    END IF;

    v_rolled_back_at := clock_timestamp();
    UPDATE vc.provider_deployment d
       SET admission_state = 'DISABLED',
           updated_at = v_rolled_back_at
     WHERE d.provider_id = v_provider_id
       AND d.admission_state IS DISTINCT FROM 'DISABLED';
    v_changed := FOUND;

    INSERT INTO vc.provider_rollback_history(
            provider_id, trigger_code, actor_code,
            previous_admission_state, changed, rolled_back_at)
    VALUES (v_provider_id, p_trigger_code, p_actor_code,
            v_previous_admission_state, v_changed, v_rolled_back_at)
    RETURNING id INTO v_history_id;

    RETURN QUERY SELECT v_history_id, v_previous_admission_state,
                        v_changed, v_rolled_back_at;
END;
$$;

REVOKE ALL ON FUNCTION vc.rollback_provider_deployment(text, text, text)
    FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;
GRANT EXECUTE ON FUNCTION vc.rollback_provider_deployment(text, text, text)
    TO vc_worker, vc_job_coordinator;
