-- W11-1: one tool-execution record and a cancellable V39 reminder.
--
-- The execution row commits before any reminder or follow-up change. begin
-- inserts RUNNING and returns; apply locks that row and writes the business
-- effect, then marks SUCCEEDED or FAILED. A repeat of the same owner
-- idempotency key returns the original execution and does not write again.
-- Runtime roles may select executions but cannot insert them. Owner and
-- relationship come from the session chat binding inside apply; a model
-- supplied owner or relationship is a failed execution.
--
-- V39 stays. CANCELLED is terminal (cancelled_at set, row kept). The export
-- keeps the existing top-level keys and adds the new reminder fields inside
-- the reminders array. Tool executions are removed with the account and are
-- not a new export domain.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE vc.tool_execution_id_seq AS bigint;

CREATE TABLE vc.tool_execution (
    owner_user_id   bigint      NOT NULL,
    id              bigint      NOT NULL DEFAULT nextval('vc.tool_execution_id_seq'),
    idempotency_key text        NOT NULL,
    chat_identity   text        NOT NULL,
    relationship_id bigint,
    tool_name       text        NOT NULL,
    status          text        NOT NULL,
    failure_code    text,
    result          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    purpose         text,
    model_revision  text,
    step_count      integer,
    timeout_ms      integer,
    token_limit     integer,
    created_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    finished_at     timestamptz,
    payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    PRIMARY KEY (owner_user_id, id),
    CONSTRAINT tool_execution_idempotency UNIQUE (owner_user_id, idempotency_key),
    CONSTRAINT tool_execution_key_shape CHECK (idempotency_key ~ '^[A-Za-z0-9._:~-]{8,200}$'),
    CONSTRAINT tool_execution_chat CHECK (
        chat_identity ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
    CONSTRAINT tool_execution_tool CHECK (tool_name ~ '^[a-z0-9_]{1,64}$'),
    CONSTRAINT tool_execution_status CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT tool_execution_terminal CHECK (
        ((status = 'FAILED') = (failure_code IS NOT NULL))
        AND ((status <> 'RUNNING') = (finished_at IS NOT NULL))),
    CONSTRAINT tool_execution_failure_code CHECK (
        failure_code IS NULL OR failure_code ~ '^[A-Z0-9_]{1,64}$'),
    CONSTRAINT tool_execution_purpose CHECK (
        purpose IS NULL OR (char_length(purpose) BETWEEN 1 AND 64 AND btrim(purpose) = purpose)),
    CONSTRAINT tool_execution_revision CHECK (
        model_revision IS NULL OR (
            char_length(model_revision) BETWEEN 1 AND 128 AND btrim(model_revision) = model_revision)),
    CONSTRAINT tool_execution_meter_range CHECK (
        (step_count IS NULL OR step_count BETWEEN -1000000 AND 1000000)
        AND (timeout_ms IS NULL OR timeout_ms BETWEEN -1000000 AND 1000000)
        AND (token_limit IS NULL OR token_limit BETWEEN -1000000 AND 1000000)),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE
);

ALTER TABLE vc.tool_execution ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.tool_execution FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.tool_execution FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.tool_execution, vc.tool_execution_id_seq FROM PUBLIC;
GRANT SELECT ON vc.tool_execution TO vc_api, vc_worker;
GRANT USAGE, SELECT ON SEQUENCE vc.tool_execution_id_seq TO vc_api, vc_worker;

ALTER TABLE vc.reminder DROP CONSTRAINT reminder_status_check;
ALTER TABLE vc.reminder
    ADD CONSTRAINT reminder_status_check CHECK (status IN ('ACTIVE', 'DISMISSED', 'CANCELLED')),
    ADD COLUMN idempotency_key text,
    ADD COLUMN execution_id bigint,
    ADD COLUMN cancelled_at timestamptz,
    ADD CONSTRAINT reminder_idempotency_shape CHECK (
        idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9._:~-]{8,200}$'),
    ADD CONSTRAINT reminder_cancel_terminal CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL)),
    ADD CONSTRAINT reminder_execution_fk
        FOREIGN KEY (owner_user_id, execution_id)
        REFERENCES vc.tool_execution(owner_user_id, id) ON DELETE CASCADE;

CREATE UNIQUE INDEX reminder_idempotency_key
    ON vc.reminder (owner_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- A cancelled reminder cannot be edited back to ACTIVE. The user update
-- signature and its grants stay; status is still only ACTIVE or DISMISSED.
CREATE OR REPLACE FUNCTION vc.update_reminder(
    p_owner_user_id bigint,
    p_reminder_id   bigint,
    p_text          text,
    p_remind_at     timestamptz,
    p_recurrence    text,
    p_status        text
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
        RAISE EXCEPTION 'update_reminder: owner_user_id is required';
    END IF;
    IF p_reminder_id IS NULL OR p_reminder_id <= 0 THEN
        RAISE EXCEPTION 'update_reminder: reminder id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'update_reminder: owner_user_id must match server-trusted context';
    END IF;
    IF p_text IS NULL OR btrim(p_text) = '' OR length(p_text) > 500 THEN
        RAISE EXCEPTION 'update_reminder: text must be 1..500 characters';
    END IF;
    IF p_remind_at IS NULL THEN
        RAISE EXCEPTION 'update_reminder: remind_at is required';
    END IF;
    IF p_recurrence NOT IN ('NONE', 'DAILY', 'WEEKLY') THEN
        RAISE EXCEPTION 'update_reminder: recurrence must be NONE, DAILY or WEEKLY';
    END IF;
    IF p_status NOT IN ('ACTIVE', 'DISMISSED') THEN
        RAISE EXCEPTION 'update_reminder: status must be ACTIVE or DISMISSED';
    END IF;
    IF EXISTS (
        SELECT 1 FROM vc.reminder
         WHERE owner_user_id = p_owner_user_id AND id = p_reminder_id AND status = 'CANCELLED'
    ) THEN
        RAISE EXCEPTION 'update_reminder: cancelled reminder is terminal';
    END IF;

    UPDATE vc.reminder
       SET text = btrim(p_text),
           remind_at = p_remind_at,
           recurrence = p_recurrence,
           status = p_status,
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_reminder_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

CREATE FUNCTION vc.begin_tool_execution(
    p_owner bigint,
    p_chat text,
    p_key text,
    p_payload jsonb,
    p_purpose text,
    p_model_revision text,
    p_step integer,
    p_timeout_ms integer,
    p_token_limit integer
)
    RETURNS TABLE(out_id bigint, out_status text, out_fresh boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_status text;
    v_chat text;
    v_key text;
    v_purpose text;
    v_revision text;
    v_payload jsonb;
    v_args jsonb;
    v_tool text;
    v_name text;
    v_forbidden boolean;
    v_assistant boolean;
    v_legal boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_owner IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'tool_execution: owner_user_id must match server-trusted context';
    END IF;
    v_chat := btrim(p_chat);
    v_key := btrim(p_key);
    IF v_chat IS NULL OR v_chat !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RAISE EXCEPTION 'tool_execution: chat_identity is invalid';
    END IF;
    IF v_key IS NULL OR v_key !~ '^[A-Za-z0-9._:~-]{8,200}$' THEN
        RAISE EXCEPTION 'tool_execution: idempotency_key is invalid';
    END IF;
    v_purpose := NULLIF(btrim(p_purpose), '');
    v_revision := NULLIF(btrim(p_model_revision), '');
    v_payload := COALESCE(p_payload, '{}'::jsonb);
    v_args := v_payload->'arguments';
    v_forbidden := COALESCE((v_payload->>'forbidden')::boolean, false)
        OR (jsonb_typeof(v_args) = 'object' AND v_args ?| ARRAY['relationshipId', 'ownerUserId', 'ownerId', 'ownerAccountId']);
    v_tool := COALESCE(v_payload->>'tool', '');
    v_assistant := COALESCE((v_payload->>'assistant')::boolean, false)
        OR v_payload->>'role' = 'assistant'
        OR v_payload ? 'content'
        OR v_payload ? 'utterance';
    v_legal := v_tool IN ('query_scheduled_follow_ups', 'manage_reminder');
    IF v_forbidden THEN
        v_name := 'rejected';
    ELSIF v_assistant AND NOT v_legal THEN
        v_name := 'assistant_text';
    ELSIF v_legal THEN
        v_name := v_tool;
    ELSE
        v_name := 'unknown';
    END IF;
    -- Dialogue text is not an execution fact. Reminder text stays under arguments.
    v_payload := v_payload - ARRAY['content', 'utterance', 'role', 'text'];

    INSERT INTO vc.tool_execution (
        owner_user_id, idempotency_key, chat_identity, tool_name, status,
        purpose, model_revision, step_count, timeout_ms, token_limit, payload)
    VALUES (
        p_owner, v_key, v_chat, v_name, 'RUNNING',
        v_purpose, v_revision, p_step, p_timeout_ms, p_token_limit, v_payload)
    ON CONFLICT ON CONSTRAINT tool_execution_idempotency DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT e.id, e.status INTO v_id, v_status
          FROM vc.tool_execution e
         WHERE e.owner_user_id = p_owner AND e.idempotency_key = v_key;
        out_fresh := false;
    ELSE
        v_status := 'RUNNING';
        out_fresh := true;
    END IF;
    out_id := v_id;
    out_status := v_status;
    RETURN NEXT;
END;
$$;

CREATE FUNCTION vc.fail_tool_execution(
    p_owner bigint,
    p_id bigint,
    p_code text,
    p_relationship bigint
)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.tool_execution
       SET status = 'FAILED',
           failure_code = p_code,
           result = '{}'::jsonb,
           finished_at = clock_timestamp(),
           relationship_id = COALESCE(p_relationship, relationship_id)
     WHERE owner_user_id = p_owner AND id = p_id AND status = 'RUNNING';
END;
$$;

CREATE FUNCTION vc.succeed_tool_execution(
    p_owner bigint,
    p_id bigint,
    p_relationship bigint,
    p_result jsonb
)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.tool_execution
       SET status = 'SUCCEEDED',
           failure_code = NULL,
           result = COALESCE(p_result, '{}'::jsonb),
           finished_at = clock_timestamp(),
           relationship_id = p_relationship
     WHERE owner_user_id = p_owner AND id = p_id AND status = 'RUNNING';
END;
$$;

CREATE FUNCTION vc.apply_tool_execution(p_owner bigint, p_id bigint)
    RETURNS TABLE(
        out_id bigint,
        out_tool text,
        out_status text,
        out_failure_code text,
        out_result jsonb,
        out_purpose text,
        out_model_revision text,
        out_step integer,
        out_timeout_ms integer,
        out_token_limit integer
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_tool text;
    v_status text;
    v_payload jsonb;
    v_args jsonb;
    v_chat text;
    v_key text;
    v_rel bigint;
    v_code text;
    v_result jsonb := '{}'::jsonb;
    v_step integer;
    v_timeout integer;
    v_token integer;
    v_allowed boolean;
    v_action text;
    v_text text;
    v_rec text;
    v_raw text;
    v_ts timestamptz;
    v_target bigint;
    v_row_rel bigint;
    v_row_status text;
    v_cancelled timestamptz;
    v_new bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_owner IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'tool_execution: owner_user_id must match server-trusted context';
    END IF;
    SELECT e.tool_name, e.status, e.payload, e.chat_identity, e.idempotency_key,
           e.step_count, e.timeout_ms, e.token_limit
      INTO v_tool, v_status, v_payload, v_chat, v_key, v_step, v_timeout, v_token
      FROM vc.tool_execution e
     WHERE e.owner_user_id = p_owner AND e.id = p_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'tool_execution: not found';
    END IF;
    IF v_status <> 'RUNNING' THEN
        RETURN QUERY
        SELECT e.id, e.tool_name, e.status, e.failure_code, e.result, e.purpose,
               e.model_revision, e.step_count, e.timeout_ms, e.token_limit
          FROM vc.tool_execution e
         WHERE e.owner_user_id = p_owner AND e.id = p_id;
        RETURN;
    END IF;

    v_args := v_payload->'arguments';
    IF (v_step IS NOT NULL AND (v_step < 1 OR v_step > 8))
       OR (v_timeout IS NOT NULL AND (v_timeout < 1 OR v_timeout > 120000))
       OR (v_token IS NOT NULL AND (v_token < 1 OR v_token > 8192)) THEN
        v_code := 'INVALID_BOUNDS';
    ELSIF v_tool = 'rejected' THEN
        v_code := 'FORBIDDEN_RELATIONSHIP';
    ELSIF v_args IS NOT NULL AND jsonb_typeof(v_args) IS DISTINCT FROM 'object' THEN
        v_code := 'INVALID_ARGUMENTS';
    ELSIF v_tool = 'assistant_text' THEN
        v_code := 'ASSISTANT_TEXT';
    ELSIF v_tool = 'unknown' THEN
        v_code := 'UNKNOWN_TOOL';
    ELSE
        IF v_args IS NULL OR jsonb_typeof(v_args) IS DISTINCT FROM 'object' THEN
            v_args := '{}'::jsonb;
        END IF;
        SELECT c.relationship_id INTO v_rel
          FROM vc.conversation c
         WHERE c.owner_user_id = p_owner AND c.st_chat_identity = v_chat;
        IF NOT FOUND THEN
            v_code := 'UNBOUND_CHAT';
        ELSIF v_tool = 'query_scheduled_follow_ups' THEN
            SELECT COALESCE(jsonb_agg(item ORDER BY sort_id), '[]'::jsonb) INTO v_result
              FROM (
                SELECT f.id AS sort_id,
                       jsonb_build_object(
                           'id', f.id::text,
                           'status', f.status,
                           'triggerAt', f.trigger_at,
                           'eventDate', f.event_date,
                           'eventTime', f.event_time,
                           'eventTimezone', f.event_timezone
                       ) AS item
                  FROM vc.follow_up f
                 WHERE f.owner_user_id = p_owner
                   AND f.relationship_id = v_rel
                   AND f.status = 'SCHEDULED'
              ) q;
            v_result := jsonb_build_object('followUps', COALESCE(v_result, '[]'::jsonb));
        ELSE
            SELECT r.reminders_allowed INTO v_allowed
              FROM vc.relationship r
             WHERE r.owner_user_id = p_owner AND r.id = v_rel
             FOR UPDATE;
            IF NOT FOUND THEN
                v_code := 'UNBOUND_CHAT';
            ELSE
                v_action := v_args->>'action';
                IF v_action = 'create' THEN
                    IF v_allowed IS NOT TRUE THEN
                        v_code := 'REMINDERS_DISABLED';
                    ELSE
                        v_text := btrim(v_args->>'text');
                        v_rec := COALESCE(NULLIF(btrim(v_args->>'recurrence'), ''), 'NONE');
                        IF v_text IS NULL OR v_text = '' OR char_length(v_text) > 500
                           OR v_rec NOT IN ('NONE', 'DAILY', 'WEEKLY') THEN
                            v_code := 'INVALID_ARGUMENTS';
                        ELSE
                            v_raw := NULLIF(btrim(v_args->>'remindAt'), '');
                            IF v_raw IS NULL THEN
                                v_code := 'INVALID_ARGUMENTS';
                            ELSIF v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
                                v_code := 'DATE_ONLY';
                            ELSIF v_raw ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?$' THEN
                                v_code := 'MISSING_TIMEZONE';
                            ELSE
                                BEGIN
                                    v_ts := v_raw::timestamptz;
                                EXCEPTION WHEN OTHERS THEN
                                    v_code := 'INVALID_INSTANT';
                                END;
                            END IF;
                        END IF;
                        IF v_code IS NULL THEN
                            v_new := nextval('vc.reminder_id_seq');
                            INSERT INTO vc.reminder (
                                owner_user_id, id, relationship_id, text, remind_at, recurrence,
                                status, idempotency_key, execution_id)
                            VALUES (
                                p_owner, v_new, v_rel, v_text, v_ts, v_rec,
                                'ACTIVE', v_key, p_id)
                            ON CONFLICT (owner_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL
                            DO NOTHING;
                            IF NOT FOUND THEN
                                SELECT r.id INTO v_new
                                  FROM vc.reminder r
                                 WHERE r.owner_user_id = p_owner AND r.idempotency_key = v_key;
                            END IF;
                            v_result := jsonb_build_object(
                                'reminderId', v_new::text,
                                'status', 'ACTIVE',
                                'recurrence', v_rec,
                                'remindAt', v_ts);
                        END IF;
                    END IF;
                ELSIF v_action = 'cancel' THEN
                    IF v_args->>'target' = 'reminder' THEN
                        BEGIN
                            v_target := (v_args->>'reminderId')::bigint;
                        EXCEPTION
                            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                                v_code := 'INVALID_ARGUMENTS';
                        END;
                        IF v_code IS NULL AND (v_target IS NULL OR v_target <= 0) THEN
                            v_code := 'INVALID_ARGUMENTS';
                        END IF;
                        IF v_code IS NULL THEN
                            SELECT r.relationship_id, r.status INTO v_row_rel, v_row_status
                              FROM vc.reminder r
                             WHERE r.owner_user_id = p_owner AND r.id = v_target
                             FOR UPDATE;
                            IF NOT FOUND OR v_row_rel IS DISTINCT FROM v_rel THEN
                                v_code := 'NOT_FOUND';
                            ELSE
                                IF v_row_status <> 'CANCELLED' THEN
                                    UPDATE vc.reminder
                                       SET status = 'CANCELLED',
                                           cancelled_at = clock_timestamp(),
                                           updated_at = clock_timestamp()
                                     WHERE owner_user_id = p_owner AND id = v_target;
                                END IF;
                                SELECT r.status, r.cancelled_at INTO v_row_status, v_cancelled
                                  FROM vc.reminder r
                                 WHERE r.owner_user_id = p_owner AND r.id = v_target;
                                v_result := jsonb_build_object(
                                    'reminderId', v_target::text,
                                    'status', v_row_status,
                                    'cancelledAt', v_cancelled);
                            END IF;
                        END IF;
                    ELSIF v_args->>'target' = 'follow_up' THEN
                        BEGIN
                            v_target := (v_args->>'followUpId')::bigint;
                        EXCEPTION
                            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                                v_code := 'INVALID_ARGUMENTS';
                        END;
                        IF v_code IS NULL AND (v_target IS NULL OR v_target <= 0) THEN
                            v_code := 'INVALID_ARGUMENTS';
                        END IF;
                        IF v_code IS NULL THEN
                            SELECT f.relationship_id, f.status INTO v_row_rel, v_row_status
                              FROM vc.follow_up f
                             WHERE f.owner_user_id = p_owner AND f.id = v_target
                             FOR UPDATE;
                            IF NOT FOUND OR v_row_rel IS DISTINCT FROM v_rel THEN
                                v_code := 'NOT_FOUND';
                            ELSE
                                PERFORM vc.cancel_follow_up(p_owner, v_target);
                                SELECT f.status, f.cancelled_at INTO v_row_status, v_cancelled
                                  FROM vc.follow_up f
                                 WHERE f.owner_user_id = p_owner AND f.id = v_target;
                                v_result := jsonb_build_object(
                                    'followUpId', v_target::text,
                                    'status', v_row_status,
                                    'cancelledAt', v_cancelled);
                            END IF;
                        END IF;
                    ELSE
                        v_code := 'INVALID_ARGUMENTS';
                    END IF;
                ELSE
                    v_code := 'INVALID_ARGUMENTS';
                END IF;
            END IF;
        END IF;
    END IF;

    IF v_code IS NULL THEN
        PERFORM vc.succeed_tool_execution(p_owner, p_id, v_rel, v_result);
    ELSE
        PERFORM vc.fail_tool_execution(p_owner, p_id, v_code, v_rel);
    END IF;
    RETURN QUERY
    SELECT e.id, e.tool_name, e.status, e.failure_code, e.result, e.purpose,
           e.model_revision, e.step_count, e.timeout_ms, e.token_limit
      FROM vc.tool_execution e
     WHERE e.owner_user_id = p_owner AND e.id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION
    vc.begin_tool_execution(bigint, text, text, jsonb, text, text, integer, integer, integer),
    vc.apply_tool_execution(bigint, bigint),
    vc.fail_tool_execution(bigint, bigint, text, bigint),
    vc.succeed_tool_execution(bigint, bigint, bigint, jsonb)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.begin_tool_execution(bigint, text, text, jsonb, text, text, integer, integer, integer),
    vc.apply_tool_execution(bigint, bigint)
    TO vc_api, vc_worker;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint) RENAME TO export_v2_owner_metadata_v190;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN (vc.export_v2_owner_metadata_v190(p_owner) - 'reminders') || jsonb_build_object(
        'reminders', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'reminderId', r.id::text,
                'relationshipId', r.relationship_id::text,
                'text', r.text,
                'remindAt', r.remind_at,
                'recurrence', r.recurrence,
                'status', r.status,
                'idempotencyKey', r.idempotency_key,
                'executionId', r.execution_id::text,
                'cancelledAt', r.cancelled_at
            ) ORDER BY r.id)
              FROM vc.reminder r
             WHERE r.owner_user_id = p_owner
        ), '[]'::jsonb)
    );
END;
$$;

REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint), vc.export_v2_owner_metadata_v190(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_v190(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
