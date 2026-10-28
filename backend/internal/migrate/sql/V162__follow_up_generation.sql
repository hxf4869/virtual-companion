-- W09-S4: background greeting generation for a follow-up.
-- Catalog follow-up statuses are unchanged. A safety block is generation_outcome
-- BLOCKED and moves the row to SILENT so it is not claimed again; the greeting
-- text is not stored. NOT_GENERATED and POLICY_DISABLED leave SCHEDULED.
-- V39 vc.reminder is untouched.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.follow_up
    ADD COLUMN greeting_body text,
    ADD COLUMN generation_outcome text,
    ADD COLUMN generation_reason text,
    ADD COLUMN generation_provider_id text,
    ADD COLUMN generation_model_id text,
    ADD COLUMN generation_protocol text,
    ADD COLUMN generation_provider_revision bigint,
    ADD COLUMN generation_binding_revision bigint,
    ADD COLUMN generation_params jsonb;

ALTER TABLE vc.follow_up
    ADD CONSTRAINT follow_up_greeting_len CHECK (
        greeting_body IS NULL
        OR (char_length(greeting_body) BETWEEN 1 AND 4000 AND btrim(greeting_body) <> '')),
    ADD CONSTRAINT follow_up_greeting_shape CHECK (
        (greeting_body IS NULL AND status <> 'BODY_READY')
        OR (
            greeting_body IS NOT NULL
            AND status = 'BODY_READY'
            AND deliverable = 'DELIVERABLE'
            AND generation_outcome = 'BODY_READY')),
    ADD CONSTRAINT follow_up_generation_outcome CHECK (
        generation_outcome IS NULL OR generation_outcome IN (
            'WAITING_HOST', 'BODY_READY', 'BLOCKED', 'NOT_GENERATED',
            'CANCELLED', 'SOURCE_INVALID', 'POLICY_DISABLED')),
    ADD CONSTRAINT follow_up_generation_reason CHECK (
        generation_reason IS NULL OR generation_reason ~ '^[A-Za-z0-9_-]{1,64}$'),
    ADD CONSTRAINT follow_up_generation_outcome_shape CHECK (
        (generation_outcome IS DISTINCT FROM 'BODY_READY'
            OR (status = 'BODY_READY' AND greeting_body IS NOT NULL AND deliverable = 'DELIVERABLE'))
        AND (generation_outcome IS DISTINCT FROM 'WAITING_HOST'
            OR (status = 'WAITING_HOST' AND greeting_body IS NULL AND deliverable = 'NOT_DELIVERABLE'))
        AND (generation_outcome IS DISTINCT FROM 'BLOCKED'
            OR (status = 'SILENT' AND greeting_body IS NULL AND deliverable = 'NOT_DELIVERABLE'))
        AND (generation_outcome IS DISTINCT FROM 'CANCELLED' OR status = 'CANCELLED')
        AND (generation_outcome IS DISTINCT FROM 'SOURCE_INVALID' OR status = 'CANCELLED')),
    ADD CONSTRAINT follow_up_generation_provider CHECK (
        generation_provider_id IS NULL OR generation_provider_id ~ '^[a-z][a-z0-9-]{0,63}$'),
    ADD CONSTRAINT follow_up_generation_model CHECK (
        generation_model_id IS NULL
        OR (char_length(generation_model_id) BETWEEN 1 AND 200 AND btrim(generation_model_id) <> '')),
    ADD CONSTRAINT follow_up_generation_protocol CHECK (
        generation_protocol IS NULL OR generation_protocol IN (
            'OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES')),
    ADD CONSTRAINT follow_up_generation_revision CHECK (
        (generation_provider_revision IS NULL OR generation_provider_revision >= 0)
        AND (generation_binding_revision IS NULL OR generation_binding_revision >= 0)),
    ADD CONSTRAINT follow_up_generation_params CHECK (
        generation_params IS NULL
        OR (jsonb_typeof(generation_params) = 'object' AND octet_length(generation_params::text) <= 2000));

CREATE FUNCTION vc.load_follow_up_generation(p_owner bigint, p_follow_up bigint)
    RETURNS TABLE (
        out_id bigint,
        out_relationship_id bigint,
        out_status text,
        out_body text,
        out_event_id text,
        out_deliverable text,
        out_greeting text,
        out_outcome text,
        out_reason text,
        out_source_valid boolean,
        out_policy_enabled boolean,
        out_offline_capable boolean,
        out_companion_name text,
        out_user_address_as text,
        out_reply_length text,
        out_initiative text,
        out_humor text,
        out_advice_pref text,
        out_memory_share_scope text,
        out_avoid_topics text,
        out_gender text,
        out_memory_item_id bigint,
        out_source_ref text,
        out_source_revision bigint,
        out_provider_id text,
        out_model_id text,
        out_protocol text,
        out_provider_revision bigint,
        out_binding_revision bigint,
        out_params jsonb)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.follow_up%ROWTYPE;
    v_source boolean := false;
    v_enabled boolean := false;
    v_offline boolean := false;
    v_name text;
    v_address text;
    v_reply text;
    v_initiative text;
    v_humor text;
    v_advice text;
    v_memory text;
    v_avoid text;
    v_gender text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT * INTO v_row
      FROM vc.follow_up
     WHERE owner_user_id = p_owner AND id = p_follow_up;
    IF NOT FOUND THEN
        RETURN;
    END IF;
    IF v_row.memory_item_id IS NOT NULL AND v_row.source_ref IS NOT NULL
       AND vc.memory_current_for_follow_up(p_owner, v_row.relationship_id, v_row.memory_item_id)
       AND vc.guard_st_memory_source(p_owner, v_row.relationship_id, v_row.source_ref) THEN
        IF v_row.source_revision IS NULL OR EXISTS (
            SELECT 1
              FROM vc.st_message_source s
             WHERE s.owner_user_id = p_owner
               AND s.source_ref = v_row.source_ref
               AND s.source_revision = v_row.source_revision
               AND s.present AND s.settled AND s.eligible AND NOT s.suppressed) THEN
            v_source := true;
        END IF;
    END IF;
    SELECT COALESCE(p.enabled, false), COALESCE(p.offline_capable, false)
      INTO v_enabled, v_offline
      FROM vc.relationship r
      LEFT JOIN vc.proactive_policy p
        ON p.owner_user_id = r.owner_user_id AND p.relationship_id = r.id
     WHERE r.owner_user_id = p_owner AND r.id = v_row.relationship_id;
    SELECT r.companion_name, r.user_address_as, r.reply_length, r.initiative,
           r.humor, r.advice_pref, r.memory_share_scope, r.avoid_topics, r.gender
      INTO v_name, v_address, v_reply, v_initiative, v_humor, v_advice, v_memory, v_avoid, v_gender
      FROM vc.relationship r
     WHERE r.owner_user_id = p_owner AND r.id = v_row.relationship_id;
    RETURN QUERY
    SELECT v_row.id, v_row.relationship_id, v_row.status, v_row.body, v_row.event_id,
           v_row.deliverable, v_row.greeting_body, v_row.generation_outcome, v_row.generation_reason,
           v_source, COALESCE(v_enabled, false), COALESCE(v_offline, false),
           v_name, v_address, COALESCE(v_reply, ''), COALESCE(v_initiative, ''),
           COALESCE(v_humor, ''), COALESCE(v_advice, ''), COALESCE(v_memory, ''),
           COALESCE(v_avoid, ''), COALESCE(v_gender, ''),
           v_row.memory_item_id, v_row.source_ref, v_row.source_revision,
           v_row.generation_provider_id, v_row.generation_model_id, v_row.generation_protocol,
           v_row.generation_provider_revision, v_row.generation_binding_revision,
           v_row.generation_params;
END;
$$;

CREATE FUNCTION vc.finish_follow_up_generation(
    p_owner bigint,
    p_follow_up bigint,
    p_outcome text,
    p_reason text,
    p_greeting text,
    p_provider_id text,
    p_model_id text,
    p_protocol text,
    p_provider_revision bigint,
    p_binding_revision bigint,
    p_params jsonb)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.follow_up%ROWTYPE;
    v_greeting text := NULLIF(btrim(p_greeting), '');
    v_provider text := NULLIF(btrim(p_provider_id), '');
    v_model text := NULLIF(btrim(p_model_id), '');
    v_protocol text := NULLIF(btrim(p_protocol), '');
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_outcome IS NULL OR p_outcome NOT IN (
        'WAITING_HOST', 'BODY_READY', 'BLOCKED', 'NOT_GENERATED',
        'CANCELLED', 'SOURCE_INVALID', 'POLICY_DISABLED') THEN
        RAISE EXCEPTION 'follow_up: generation outcome is not allowed';
    END IF;
    IF p_reason IS NULL OR p_reason !~ '^[A-Za-z0-9_-]{1,64}$' THEN
        RAISE EXCEPTION 'follow_up: generation reason is invalid';
    END IF;
    IF p_outcome = 'BLOCKED' AND v_greeting IS NOT NULL THEN
        RAISE EXCEPTION 'follow_up: blocked generation cannot store a body';
    END IF;
    IF p_outcome <> 'BODY_READY' AND v_greeting IS NOT NULL THEN
        RAISE EXCEPTION 'follow_up: generation cannot store a body';
    END IF;
    IF p_outcome = 'BODY_READY' AND v_greeting IS NULL THEN
        RAISE EXCEPTION 'follow_up: body ready requires a greeting';
    END IF;
    IF v_greeting IS NOT NULL AND char_length(v_greeting) > 4000 THEN
        RAISE EXCEPTION 'follow_up: greeting is invalid';
    END IF;
    IF v_provider IS NOT NULL AND v_provider !~ '^[a-z][a-z0-9-]{0,63}$' THEN
        RAISE EXCEPTION 'follow_up: generation provider is invalid';
    END IF;
    IF v_model IS NOT NULL AND (char_length(v_model) > 200 OR btrim(v_model) = '') THEN
        RAISE EXCEPTION 'follow_up: generation model is invalid';
    END IF;
    IF v_protocol IS NOT NULL AND v_protocol NOT IN (
        'OPENAI_CHAT_COMPLETIONS', 'OPENAI_RESPONSES', 'ANTHROPIC_MESSAGES') THEN
        RAISE EXCEPTION 'follow_up: generation protocol is invalid';
    END IF;
    IF p_params IS NOT NULL AND (
        jsonb_typeof(p_params) <> 'object' OR octet_length(p_params::text) > 2000) THEN
        RAISE EXCEPTION 'follow_up: generation params are invalid';
    END IF;
    SELECT * INTO v_row
      FROM vc.follow_up
     WHERE owner_user_id = p_owner AND id = p_follow_up
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'follow_up: not found';
    END IF;
    IF v_row.generation_outcome IN (
        'BODY_READY', 'WAITING_HOST', 'BLOCKED', 'CANCELLED', 'SOURCE_INVALID') THEN
        IF v_row.generation_outcome = p_outcome THEN
            RETURN;
        END IF;
        RAISE EXCEPTION 'follow_up: generation is already finished';
    END IF;
    IF v_row.status = 'CANCELLED' AND p_outcome NOT IN ('CANCELLED', 'SOURCE_INVALID') THEN
        RAISE EXCEPTION 'follow_up: cancelled follow-up cannot be generated';
    END IF;
    IF p_outcome = 'BODY_READY' THEN
        UPDATE vc.follow_up
           SET status = 'BODY_READY',
               deliverable = 'DELIVERABLE',
               trigger_at = NULL,
               greeting_body = v_greeting,
               generation_outcome = p_outcome,
               generation_reason = p_reason,
               generation_provider_id = v_provider,
               generation_model_id = v_model,
               generation_protocol = v_protocol,
               generation_provider_revision = p_provider_revision,
               generation_binding_revision = p_binding_revision,
               generation_params = p_params
         WHERE owner_user_id = p_owner AND id = p_follow_up;
        RETURN;
    END IF;
    IF p_outcome = 'WAITING_HOST' THEN
        UPDATE vc.follow_up
           SET status = 'WAITING_HOST',
               deliverable = 'NOT_DELIVERABLE',
               trigger_at = NULL,
               greeting_body = NULL,
               generation_outcome = p_outcome,
               generation_reason = p_reason,
               generation_provider_id = v_provider,
               generation_model_id = v_model,
               generation_protocol = v_protocol,
               generation_provider_revision = p_provider_revision,
               generation_binding_revision = p_binding_revision,
               generation_params = p_params
         WHERE owner_user_id = p_owner AND id = p_follow_up;
        RETURN;
    END IF;
    IF p_outcome = 'BLOCKED' THEN
        UPDATE vc.follow_up
           SET status = 'SILENT',
               deliverable = 'NOT_DELIVERABLE',
               trigger_at = NULL,
               greeting_body = NULL,
               generation_outcome = p_outcome,
               generation_reason = p_reason,
               generation_provider_id = v_provider,
               generation_model_id = v_model,
               generation_protocol = v_protocol,
               generation_provider_revision = p_provider_revision,
               generation_binding_revision = p_binding_revision,
               generation_params = p_params
         WHERE owner_user_id = p_owner AND id = p_follow_up;
        RETURN;
    END IF;
    IF p_outcome IN ('CANCELLED', 'SOURCE_INVALID') THEN
        UPDATE vc.follow_up
           SET status = 'CANCELLED',
               deliverable = 'NOT_DELIVERABLE',
               trigger_at = NULL,
               cancelled_at = COALESCE(cancelled_at, clock_timestamp()),
               greeting_body = NULL,
               generation_outcome = p_outcome,
               generation_reason = p_reason,
               generation_provider_id = v_provider,
               generation_model_id = v_model,
               generation_protocol = v_protocol,
               generation_provider_revision = p_provider_revision,
               generation_binding_revision = p_binding_revision,
               generation_params = p_params
         WHERE owner_user_id = p_owner AND id = p_follow_up;
        RETURN;
    END IF;
    UPDATE vc.follow_up
       SET greeting_body = NULL,
           generation_outcome = p_outcome,
           generation_reason = p_reason,
           generation_provider_id = COALESCE(v_provider, generation_provider_id),
           generation_model_id = COALESCE(v_model, generation_model_id),
           generation_protocol = COALESCE(v_protocol, generation_protocol),
           generation_provider_revision = COALESCE(p_provider_revision, generation_provider_revision),
           generation_binding_revision = COALESCE(p_binding_revision, generation_binding_revision),
           generation_params = COALESCE(p_params, generation_params)
     WHERE owner_user_id = p_owner AND id = p_follow_up;
END;
$$;

CREATE FUNCTION vc.prepare_follow_up_model_call(
    p_owner bigint,
    p_job bigint,
    p_attempt text,
    p_provider text,
    p_model text,
    p_input bigint,
    p_output bigint,
    p_ceiling bigint,
    p_monthly bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_attempt IS NULL OR btrim(p_attempt) = '' OR p_job IS NULL OR p_job <= 0 THEN
        RAISE EXCEPTION 'follow_up: attempt is required';
    END IF;
    SELECT r.status INTO v_status
      FROM vc.model_cost_reservation r
     WHERE r.provider_attempt_id = p_attempt;
    IF FOUND THEN
        IF v_status = 'HELD' THEN
            RETURN 'REUSED_HELD';
        END IF;
        IF v_status = 'SETTLED' THEN
            RETURN 'REUSED_SETTLED';
        END IF;
        IF v_status = 'RELEASED' THEN
            RETURN 'REUSED_RELEASED';
        END IF;
    END IF;
    BEGIN
        PERFORM vc.go_hold_model_cost(
            p_owner, p_job, p_attempt, p_provider, p_model, p_input, p_output, p_ceiling, p_monthly);
    EXCEPTION WHEN unique_violation THEN
        RETURN 'REUSED_HELD';
    END;
    RETURN 'HELD';
END;
$$;

CREATE FUNCTION vc.settle_follow_up_model_call(
    p_owner bigint,
    p_attempt text,
    p_disposition text,
    p_input bigint,
    p_output bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_disposition IS NULL OR p_disposition NOT IN ('NOT_SENT', 'USAGE_REPORTED', 'UNKNOWN') THEN
        RAISE EXCEPTION 'follow_up: cost disposition is not allowed';
    END IF;
    RETURN vc.go_settle_held_model_cost(p_attempt, p_disposition, p_input, p_output);
END;
$$;

-- Returns the cipher only while the frozen provider revision is still enabled
-- and still has a credential. Go decrypts it. Callers never persist the secret.
CREATE FUNCTION vc.follow_up_provider_credential(p_provider text, p_revision bigint)
    RETURNS text
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT p.credential_cipher
      FROM vc.provider_config p
     WHERE p.provider_id = p_provider
       AND p.revision = p_revision
       AND p.state = 'ENABLED'
       AND p.credential_cipher IS NOT NULL;
$$;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint) RENAME TO export_v2_owner_metadata_v160;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN (vc.export_v2_owner_metadata_v160(p_owner) - 'followUps') || jsonb_build_object(
        'followUps', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'followUpId', f.id::text,
                'relationshipId', f.relationship_id::text,
                'memoryItemId', f.memory_item_id::text,
                'sourceRef', f.source_ref,
                'sourceRevision', f.source_revision,
                'status', f.status,
                'body', f.body,
                'normalizationStatus', f.normalization_status,
                'timePrecision', f.time_precision,
                'reminderRuleConfirmed', f.reminder_rule_confirmed,
                'eventDate', f.event_date,
                'eventTime', f.event_time,
                'eventTimezone', f.event_timezone,
                'triggerAt', f.trigger_at,
                'eventId', f.event_id,
                'deliverable', f.deliverable,
                'greetingBody', f.greeting_body,
                'generationOutcome', f.generation_outcome,
                'generationReason', f.generation_reason
            ) ORDER BY f.id)
              FROM vc.follow_up f
             WHERE f.owner_user_id = p_owner), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION
    vc.load_follow_up_generation(bigint, bigint),
    vc.finish_follow_up_generation(bigint, bigint, text, text, text, text, text, text, bigint, bigint, jsonb),
    vc.prepare_follow_up_model_call(bigint, bigint, text, text, text, bigint, bigint, bigint, bigint),
    vc.settle_follow_up_model_call(bigint, text, text, bigint, bigint),
    vc.follow_up_provider_credential(text, bigint),
    vc.export_v2_owner_metadata(bigint),
    vc.export_v2_owner_metadata_v160(bigint)
    FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_v160(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION
    vc.load_follow_up_generation(bigint, bigint),
    vc.finish_follow_up_generation(bigint, bigint, text, text, text, text, text, text, bigint, bigint, jsonb),
    vc.prepare_follow_up_model_call(bigint, bigint, text, text, text, bigint, bigint, bigint, bigint),
    vc.settle_follow_up_model_call(bigint, text, text, bigint, bigint),
    vc.export_v2_owner_metadata(bigint)
    TO vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.follow_up_provider_credential(text, bigint) TO vc_worker;
