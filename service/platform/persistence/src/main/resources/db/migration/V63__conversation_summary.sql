-- CONV-SUMMARY V63: L2 conversation summaries (§11.18) + the FR-CHAT-004
-- summary-reference check.
--
-- vc.conversation_summary is an append-only version chain per conversation:
-- every row records the covered message id range (from/to), the summarizer
-- model + prompt version, a confidence, a validated flag, the producing
-- service class and the previous row id (上一摘要版本). The quality floor:
-- a summary produced at a LOWER service class never overwrites a validated
-- summary produced at a HIGHER one — the old row stays and the new write is
-- skipped (返回 0；低质模型不覆盖高质摘要，等稳定档恢复后再更新).
--
-- FR-CHAT-004 (删除消息时检查会话摘要引用): delete_message now also
-- invalidates summaries whose covered range contains the deleted message —
-- the summary row stays (audit chain) but valid=false, and readers only
-- surface valid rows.
--
-- The Alpha summarizer is deterministic (statistics-only copy, never invented
-- content); ZERO_LLM turns never update summaries (FR-RES-002).

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.conversation_summary_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.conversation_summary_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.conversation_summary (
    owner_user_id    bigint      NOT NULL,
    id               bigint      NOT NULL,
    conversation_id  bigint      NOT NULL,
    from_message_id  bigint      NOT NULL,
    to_message_id    bigint      NOT NULL,
    summary          text        NOT NULL,
    model_id         text        NOT NULL,
    model_version    text        NOT NULL,
    prompt_version   text        NOT NULL,
    confidence       real        NOT NULL,
    validated        boolean     NOT NULL DEFAULT true,
    service_class    text        NOT NULL,
    prev_id          bigint,
    valid            boolean     NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, conversation_id)
        REFERENCES vc.conversation(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT conversation_summary_range_check CHECK (
        from_message_id <= to_message_id),
    CONSTRAINT conversation_summary_confidence_check CHECK (
        confidence >= 0 AND confidence <= 1),
    CONSTRAINT conversation_summary_class_check CHECK (
        service_class IN ('ECONOMY', 'PREMIUM')),
    CONSTRAINT conversation_summary_prev_fk
        FOREIGN KEY (owner_user_id, prev_id)
        REFERENCES vc.conversation_summary(owner_user_id, id)
);

ALTER TABLE vc.conversation_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.conversation_summary FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.conversation_summary;
CREATE POLICY owner_isolation ON vc.conversation_summary FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.conversation_summary
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- record_conversation_summary: append one summary row. The chain: prev_id is
-- the latest existing row of the conversation. The quality floor: when the
-- latest row is validated, valid, and was produced at a HIGHER service class
-- than the new one, the write is skipped and 0 returned (低质不覆盖高质).
-- Returns the new row id (or 0).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_conversation_summary(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_from_message_id bigint,
    p_to_message_id   bigint,
    p_summary         text,
    p_model_id        text,
    p_model_version   text,
    p_prompt_version  text,
    p_confidence      real,
    p_validated       boolean,
    p_service_class   text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_prev_id bigint;
    v_prev_class text;
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_conversation_summary: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'record_conversation_summary: conversation_id is required';
    END IF;
    IF p_from_message_id IS NULL OR p_to_message_id IS NULL
       OR p_from_message_id <= 0 OR p_to_message_id <= 0
       OR p_from_message_id > p_to_message_id THEN
        RAISE EXCEPTION 'record_conversation_summary: message range is invalid';
    END IF;
    IF p_summary IS NULL OR btrim(p_summary) = '' OR length(p_summary) > 4000 THEN
        RAISE EXCEPTION 'record_conversation_summary: summary must be 1..4000 characters';
    END IF;
    IF p_model_id IS NULL OR btrim(p_model_id) = ''
       OR p_model_version IS NULL OR btrim(p_model_version) = ''
       OR p_prompt_version IS NULL OR btrim(p_prompt_version) = '' THEN
        RAISE EXCEPTION 'record_conversation_summary: model/prompt versions are required';
    END IF;
    IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 1 THEN
        RAISE EXCEPTION 'record_conversation_summary: confidence must be within [0,1]';
    END IF;
    IF p_service_class NOT IN ('ECONOMY', 'PREMIUM') THEN
        RAISE EXCEPTION 'record_conversation_summary: unapproved service class';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_conversation_summary: owner_user_id must match server-trusted context';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.conversation c
                    WHERE c.owner_user_id = p_owner_user_id
                      AND c.id = p_conversation_id) THEN
        RAISE EXCEPTION 'record_conversation_summary: conversation not found for owner';
    END IF;

    SELECT s.id, s.service_class INTO v_prev_id, v_prev_class
      FROM vc.conversation_summary s
     WHERE s.owner_user_id = p_owner_user_id
       AND s.conversation_id = p_conversation_id
     ORDER BY s.id DESC
     LIMIT 1;

    -- §11.18 低质不覆盖高质: a validated, still-valid PREMIUM summary is
    -- never replaced by an ECONOMY one (DEGRADED output).
    IF v_prev_id IS NOT NULL AND v_prev_class = 'PREMIUM'
       AND p_service_class = 'ECONOMY' THEN
        RETURN 0;
    END IF;

    v_id := nextval('vc.conversation_summary_id_seq');
    INSERT INTO vc.conversation_summary(
        owner_user_id, id, conversation_id, from_message_id, to_message_id,
        summary, model_id, model_version, prompt_version, confidence,
        validated, service_class, prev_id)
    VALUES (
        p_owner_user_id, v_id, p_conversation_id, p_from_message_id,
        p_to_message_id, btrim(p_summary), btrim(p_model_id),
        btrim(p_model_version), btrim(p_prompt_version), p_confidence,
        COALESCE(p_validated, true), p_service_class, v_prev_id);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- latest_conversation_summary: the newest VALID row (read side; invalid rows
-- stay in the chain for audit but never surface). Absent → no rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.latest_conversation_summary(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS TABLE(out_id bigint, out_from_message_id bigint, out_to_message_id bigint,
                  out_summary text, out_model_id text, out_model_version text,
                  out_prompt_version text, out_confidence real, out_validated boolean,
                  out_service_class text, out_prev_id bigint, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'latest_conversation_summary: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'latest_conversation_summary: conversation_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'latest_conversation_summary: owner_user_id must match server-trusted context';
    END IF;

    RETURN QUERY
    SELECT s.id, s.from_message_id, s.to_message_id, s.summary, s.model_id,
           s.model_version, s.prompt_version, s.confidence, s.validated,
           s.service_class, s.prev_id, s.created_at
      FROM vc.conversation_summary s
     WHERE s.owner_user_id = p_owner_user_id
       AND s.conversation_id = p_conversation_id
       AND s.valid
     ORDER BY s.id DESC
     LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- FR-CHAT-004: delete_message additionally invalidates summaries whose
-- covered range contains the deleted message (same transaction).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.delete_message(
    p_owner_user_id   bigint,
    p_conversation_id bigint,
    p_message_id      bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_message: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'delete_message: conversation id is required';
    END IF;
    IF p_message_id IS NULL OR p_message_id <= 0 THEN
        RAISE EXCEPTION 'delete_message: message id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_message: owner_user_id must match server-trusted context';
    END IF;

    -- Evidence cleanup first (same transaction): the textual source_ref
    -- 'message:<id>' is the only reference memory keeps to the message.
    DELETE FROM vc.memory_evidence
     WHERE owner_user_id = p_owner_user_id
       AND source_ref = 'message:' || p_message_id;

    DELETE FROM vc.message
     WHERE owner_user_id = p_owner_user_id
       AND id = p_message_id
       AND conversation_id = p_conversation_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN false;
    END IF;

    -- CONV-SUMMARY (FR-CHAT-004): summaries covering the deleted message no
    -- longer describe a complete range — invalidate them (rows stay for the
    -- version-chain audit; readers only surface valid rows).
    UPDATE vc.conversation_summary
       SET valid = false
     WHERE owner_user_id = p_owner_user_id
       AND conversation_id = p_conversation_id
       AND valid
       AND from_message_id <= p_message_id
       AND to_message_id >= p_message_id;
    RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- record_turn_summary: the finalize-path composition — resolves the ACTUAL
-- service class of the generation's snapshot, the covered message range
-- (conversation start .. this turn's assistant message) and appends one
-- deterministic summary row through the same quality floor. Returns the new
-- row id, or 0 when the floor skipped the write. Incognito conversations
-- are the runtime's decision to skip (FR-CHAT-005), not this SD's.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.record_turn_summary(
    p_owner_user_id  bigint,
    p_generation_id  bigint
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_conv     bigint;
    v_class    text;
    v_to_msg   bigint;
    v_from_msg bigint;
    v_count    bigint;
    v_id       bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_turn_summary: owner_user_id is required';
    END IF;
    IF p_generation_id IS NULL OR p_generation_id <= 0 THEN
        RAISE EXCEPTION 'record_turn_summary: generation_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_turn_summary: owner_user_id must match server-trusted context';
    END IF;

    SELECT g.conversation_id INTO v_conv
      FROM vc.generation g
     WHERE g.owner_user_id = p_owner_user_id AND g.id = p_generation_id;
    IF v_conv IS NULL THEN
        RAISE EXCEPTION 'record_turn_summary: generation not found for owner';
    END IF;

    -- The ACTUAL class the router consumed (V62 snapshot column).
    SELECT COALESCE(e.actual_service_class, e.service_class) INTO v_class
      FROM vc.entitlement_snapshot e
     WHERE e.owner_user_id = p_owner_user_id
       AND e.generation_id = p_generation_id;
    IF v_class IS NULL THEN
        v_class := 'ECONOMY';
    END IF;

    -- This turn's assistant message is the range end; the conversation's
    -- earliest surviving message is the range start.
    SELECT m.id INTO v_to_msg
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.generation_id = p_generation_id
       AND m.role = 'assistant'
     ORDER BY m.id DESC LIMIT 1;
    IF v_to_msg IS NULL THEN
        RETURN 0;
    END IF;
    SELECT min(m.id), count(*) INTO v_from_msg, v_count
      FROM vc.message m
     WHERE m.owner_user_id = p_owner_user_id
       AND m.conversation_id = v_conv;
    IF v_from_msg IS NULL THEN
        RETURN 0;
    END IF;

    v_id := vc.record_conversation_summary(
        p_owner_user_id, v_conv, v_from_msg, v_to_msg,
        '会话进展摘要（确定性）：截至消息 ' || v_to_msg::text
            || '，本会话共 ' || v_count::text || ' 条消息。',
        'deterministic-summarizer', '1', '1', 1.0, true, v_class);
    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.record_conversation_summary(
    bigint, bigint, bigint, bigint, text, text, text, text, real, boolean, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.latest_conversation_summary(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.delete_message(bigint, bigint, bigint) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION vc.record_turn_summary(bigint, bigint) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.record_conversation_summary(
            bigint, bigint, bigint, bigint, text, text, text, text, real, boolean, text),
                vc.latest_conversation_summary(bigint, bigint),
                vc.record_turn_summary(bigint, bigint),
                vc.delete_message(bigint, bigint, bigint)
    TO vc_api;
