-- B1-SURVEY V72: 被理解感评分采集（§26.5 / R45）.
--
-- One immutable daily score per owner (1..5), captured 随机会话后. The Beta
-- product gate (n≥200 unique raters, average vs threshold) is computed
-- OFFLINE from this table — nothing here interprets the score. FORCE RLS
-- owner_isolation: an owner sees only their own rows; there is intentionally
-- no admin SD (the B1 report reads offline through the migrator role).

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.survey_response (
    owner_user_id   bigint      NOT NULL,
    response_date   date        NOT NULL,
    score           smallint    NOT NULL CHECK (score BETWEEN 1 AND 5),
    conversation_id bigint,
    created_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, response_date),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE SET NULL
);

ALTER TABLE vc.survey_response ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.survey_response FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.survey_response;
CREATE POLICY owner_isolation ON vc.survey_response FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.survey_response
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.record_survey_response(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_score           int
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_survey_response: owner_user_id is required';
    END IF;
    IF p_score IS NULL OR p_score NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'record_survey_response: score must be 1..5';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_survey_response: owner must match server-trusted context';
    END IF;
    -- First score of the (Asia/Shanghai) day wins; later ones are no-ops.
    INSERT INTO vc.survey_response(owner_user_id, response_date, score, conversation_id)
    VALUES (p_owner_user_id,
            (now() AT TIME ZONE 'Asia/Shanghai')::date,
            p_score,
            p_conversation_id)
    ON CONFLICT (owner_user_id, response_date) DO NOTHING;
    GET DIAGNOSTICS v_owner = ROW_COUNT;
    RETURN v_owner = 1;
END;
$$;

CREATE FUNCTION vc.list_my_surveys(
    p_owner_user_id bigint,
    p_after         date DEFAULT NULL,
    p_limit         int  DEFAULT 50
)
    RETURNS TABLE(out_date date, out_score smallint, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_my_surveys: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_my_surveys: owner must match server-trusted context';
    END IF;
    RETURN QUERY
    SELECT r.response_date, r.score, r.created_at
      FROM vc.survey_response r
     WHERE r.owner_user_id = p_owner_user_id
       AND (p_after IS NULL OR r.response_date < p_after)
     ORDER BY r.response_date DESC
     LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION vc.record_survey_response(bigint, bigint, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_survey_response(bigint, bigint, int) TO vc_api;
REVOKE ALL ON FUNCTION vc.list_my_surveys(bigint, date, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.list_my_surveys(bigint, date, int) TO vc_api;
