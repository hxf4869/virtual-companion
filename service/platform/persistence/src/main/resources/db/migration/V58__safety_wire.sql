-- SAFETY-WIRE V58: deterministic safety events + catalog input-block edges.
--
-- Three pieces:
--   1. vc.safety_event — append-only compliance record of every deterministic
--      block/pause (stage INPUT / INCREMENTAL / FINAL, risk-levels catalog
--      code, rule id). Deliberately NO FK to vc.generation: safety records
--      are statutory-adjacent audit rows and must survive generation or
--      conversation deletion (§16.6; identity_auth_event precedent).
--   2. promote_generation gains the INPUT_REVIEW target (generation-states
--      catalog edge CREATED → INPUT_REVIEW) so an input-blocked turn walks
--      the catalog path instead of an illegal shortcut.
--   3. terminalize_generation gains INPUT_BLOCKED ← INPUT_REVIEW with the
--      chat.blocked terminal event (catalog edge INPUT_REVIEW →
--      INPUT_BLOCKED). The FINAL_REVIEW → OUTPUT_BLOCKED edge already exists.
--
-- No content is ever stored in a safety event — only the stage, the catalog
-- risk level and the rule id (最小必要, §20.14).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- 1. Safety events
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS vc.safety_event_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.safety_event_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.safety_event (
    owner_user_id  bigint      NOT NULL,
    id             bigint      NOT NULL,
    generation_id  bigint,
    stage          text        NOT NULL,
    risk_level     text        NOT NULL,
    rule_id        text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT safety_event_stage_check CHECK (stage IN
        ('INPUT', 'INCREMENTAL', 'FINAL')),
    CONSTRAINT safety_event_risk_check CHECK (risk_level IN
        ('R0_NORMAL', 'R1_DISTRESS', 'R2_ELEVATED', 'R3_HIGH', 'R4_IMMINENT')),
    CONSTRAINT safety_event_rule_check CHECK (btrim(rule_id) <> ''
        AND length(rule_id) <= 100)
);

ALTER TABLE vc.safety_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.safety_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.safety_event;
CREATE POLICY owner_isolation ON vc.safety_event FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.safety_event
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- record_safety_event: append one event row. generation_id may be NULL only
-- for INPUT stage rows written before the generation exists (never in the
-- current flow); the INPUT/worker callers always pass a real id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_safety_event(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_stage          text,
    p_risk_level     text,
    p_rule_id        text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_safety_event: owner_user_id is required';
    END IF;
    IF p_stage NOT IN ('INPUT', 'INCREMENTAL', 'FINAL') THEN
        RAISE EXCEPTION 'record_safety_event: unapproved stage %', p_stage;
    END IF;
    IF p_risk_level NOT IN ('R0_NORMAL', 'R1_DISTRESS', 'R2_ELEVATED',
                            'R3_HIGH', 'R4_IMMINENT') THEN
        RAISE EXCEPTION 'record_safety_event: unapproved risk level %', p_risk_level;
    END IF;
    IF p_rule_id IS NULL OR btrim(p_rule_id) = '' OR length(p_rule_id) > 100 THEN
        RAISE EXCEPTION 'record_safety_event: rule_id must be 1..100 characters';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_safety_event: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.safety_event_id_seq');
    INSERT INTO vc.safety_event(owner_user_id, id, generation_id, stage,
                                risk_level, rule_id)
    VALUES (p_owner_user_id, v_id, p_generation_id, p_stage,
            p_risk_level, btrim(p_rule_id));
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. promote_generation: INPUT_REVIEW joins the legal targets (catalog edge
--    CREATED → INPUT_REVIEW). Idempotent no-op edges preserved (V33).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.promote_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_to_status      text
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_current text;
    v_valid_map boolean;
BEGIN
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'promote_generation: owner_user_id and generation_id are required';
    END IF;
    IF p_to_status NOT IN ('IN_PROGRESS', 'FINAL_REVIEW', 'INPUT_REVIEW') THEN
        RAISE EXCEPTION 'promote_generation: unsupported target status %', p_to_status;
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'promote_generation: owner_user_id must match server-trusted context';
    END IF;

    SELECT g.status INTO v_current
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- 合法前进边（V25 + V58 INPUT_REVIEW）+ 幂等 no-op 边（GEN-RECONC）。
    v_valid_map :=
        (v_current = 'CREATED'      AND p_to_status = 'IN_PROGRESS')
     OR (v_current = 'CREATED'      AND p_to_status = 'INPUT_REVIEW')
     OR (v_current = 'IN_PROGRESS'  AND p_to_status = 'FINAL_REVIEW')
     OR (v_current = 'IN_PROGRESS'  AND p_to_status = 'IN_PROGRESS');
    IF NOT v_valid_map THEN
        RAISE EXCEPTION 'promote_generation: illegal transition % -> %', v_current, p_to_status;
    END IF;

    IF v_current = p_to_status THEN
        RETURN v_current;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id
       AND status = v_current;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'promote_generation: generation % lost the transition race (status no longer %)',
            p_generation_id, v_current;
    END IF;

    RETURN p_to_status;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. terminalize_generation: INPUT_BLOCKED ← INPUT_REVIEW with chat.blocked
--    (V58). All V15/V17 pairings preserved.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.terminalize_generation(
    p_owner_user_id  bigint,
    p_generation_id  bigint,
    p_to_status      text,
    p_event_type     text,
    p_payload        jsonb DEFAULT '{}'::jsonb
)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_generation_id IS NULL THEN
        RAISE EXCEPTION 'terminalize_generation: owner_user_id and generation_id are required';
    END IF;
    IF p_to_status NOT IN ('FAILED_FINAL','OUTPUT_BLOCKED','COMPLETED_FALLBACK','INPUT_BLOCKED') THEN
        RAISE EXCEPTION 'terminalize_generation: unsupported terminal status % (CANCELLED must use cancel_generation)',
            p_to_status;
    END IF;
    IF p_event_type IS NULL OR btrim(p_event_type) = '' THEN
        RAISE EXCEPTION 'terminalize_generation: event_type is required';
    END IF;
    -- INV-GEN-003: the terminal event type must match the terminal state.
    IF NOT (
        (p_to_status = 'FAILED_FINAL' AND p_event_type = 'chat.failed')
        OR (p_to_status = 'OUTPUT_BLOCKED' AND p_event_type = 'chat.blocked')
        OR (p_to_status = 'INPUT_BLOCKED' AND p_event_type = 'chat.blocked')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND p_event_type = 'chat.completed')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: event type % does not match terminal status %',
            p_event_type, p_to_status;
    END IF;

    SELECT g.status INTO v_status
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id
       AND g.id = p_generation_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'terminalize_generation: generation % not found for owner %',
            p_generation_id, p_owner_user_id;
    END IF;

    -- generation-states.yaml legal edges for these four terminal states:
    --   FAILED_FINAL        <- IN_PROGRESS, WAITING_FOR_CAPACITY, COMMITTING
    --   OUTPUT_BLOCKED      <- FINAL_REVIEW
    --   INPUT_BLOCKED       <- INPUT_REVIEW
    --   COMPLETED_FALLBACK  <- COMMITTING
    IF NOT (
        (p_to_status = 'FAILED_FINAL'
            AND v_status IN ('IN_PROGRESS','WAITING_FOR_CAPACITY','COMMITTING'))
        OR (p_to_status = 'OUTPUT_BLOCKED' AND v_status = 'FINAL_REVIEW')
        OR (p_to_status = 'INPUT_BLOCKED' AND v_status = 'INPUT_REVIEW')
        OR (p_to_status = 'COMPLETED_FALLBACK' AND v_status = 'COMMITTING')
    ) THEN
        RAISE EXCEPTION 'terminalize_generation: illegal transition % -> %',
            v_status, p_to_status;
    END IF;

    UPDATE vc.generation
       SET status = p_to_status
     WHERE owner_user_id = p_owner_user_id
       AND id = p_generation_id;

    -- Durable terminal event, PENDING only (published post-commit), matching
    -- finalize_generation's chat.completed (V7).
    PERFORM vc.append_terminal_event(
        p_owner_user_id, p_generation_id, p_event_type,
        COALESCE(p_payload, '{}'::jsonb));

    RETURN p_to_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.record_safety_event(bigint, bigint, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_safety_event(bigint, bigint, text, text, text) TO vc_api;
