-- MDL-2: output and timeout limits follow the configured model and deployment.
-- Retain positive metadata bounds and the existing eight-step execution limit.
CREATE OR REPLACE FUNCTION vc.apply_tool_execution(p_owner bigint, p_id bigint)
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
       OR (v_timeout IS NOT NULL AND v_timeout < 1)
       OR (v_token IS NOT NULL AND v_token < 1) THEN
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
