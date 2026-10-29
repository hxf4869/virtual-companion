-- W16 review: an account deletion intent blocks the same owner writes that
-- session messaging already refuses. reserve_model_usage and
-- record_local_embedding_call refuse before a hold or a local count.
-- apply_follow_up_due refuses only the enqueue branch. leave, defer and
-- silent still succeed. finish_follow_up_generation refuses every outcome.
-- The exception text matches the session write path.

SET search_path TO vc, pg_catalog;

CREATE OR REPLACE FUNCTION vc.reserve_model_usage(
    p_owner bigint,
    p_purpose text,
    p_attempt text,
    p_provider text,
    p_model text,
    p_input bigint,
    p_output bigint,
    p_ceiling bigint,
    p_monthly bigint)
    RETURNS TABLE(
        out_reservation_id bigint,
        out_purpose text,
        out_status text,
        out_reserved_usd text,
        out_attempt text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_price vc.model_unit_price%ROWTYPE;
    v_month date := date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC')::date;
    v_ceiling_usd numeric(18,6);
    v_estimate numeric(18,6);
    v_hold numeric(18,6);
    v_spend numeric;
    v_existing vc.model_cost_reservation%ROWTYPE;
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    IF p_purpose IS NULL OR p_purpose NOT IN ('FOREGROUND_CHAT', 'TOOL_TURN') THEN
        RAISE EXCEPTION 'model usage purpose is not reservable';
    END IF;
    IF p_attempt IS NULL OR btrim(p_attempt) = ''
       OR p_provider IS NULL OR btrim(p_provider) = ''
       OR p_model IS NULL OR btrim(p_model) = ''
       OR p_input IS NULL OR p_input < 0
       OR p_output IS NULL OR p_output < 0 THEN
        RAISE EXCEPTION 'model usage reservation not found';
    END IF;
    IF p_ceiling IS NULL OR p_ceiling <= 0 OR p_monthly IS NULL OR p_monthly <= 0 THEN
        RAISE EXCEPTION 'model usage limits are not configured';
    END IF;

    SELECT * INTO v_existing FROM vc.model_cost_reservation
     WHERE provider_attempt_id = p_attempt FOR UPDATE;
    IF FOUND THEN
        IF v_existing.status = 'HELD'
           AND v_existing.owner_user_id = p_owner
           AND v_existing.purpose = p_purpose
           AND v_existing.provider_id = p_provider
           AND v_existing.model_id = p_model THEN
            RETURN QUERY SELECT v_existing.id, v_existing.purpose, v_existing.status,
                to_char(v_existing.reserved_usd, 'FM999999999999990.000000'),
                v_existing.provider_attempt_id;
            RETURN;
        END IF;
        RAISE EXCEPTION 'model usage reservation is not reusable';
    END IF;

    SELECT * INTO v_price FROM vc.model_unit_price
     WHERE provider_id = p_provider AND model_id = p_model
       AND active AND effective_from <= clock_timestamp()
     ORDER BY price_version DESC LIMIT 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'model usage unit price is unknown';
    END IF;
    -- p_output is this request's output cap. Hold that priced cap, at most
    -- the per-call ceiling. Compare the rounded six-decimal estimate.
    v_ceiling_usd := p_ceiling::numeric / 1000000;
    v_estimate := round((p_input * v_price.input_usd_per_1k
        + p_output * v_price.output_usd_per_1k) / 1000, 6);
    IF v_estimate > v_ceiling_usd THEN
        RAISE EXCEPTION 'model usage ceiling is too small';
    END IF;
    v_hold := least(v_ceiling_usd, v_estimate);
    INSERT INTO vc.month_cost_budget(month_start) VALUES (v_month)
    ON CONFLICT (month_start) DO NOTHING;

    BEGIN
        SELECT reserved_usd + settled_usd + unsettled_usd INTO v_spend
          FROM vc.month_cost_budget
         WHERE month_start = v_month FOR UPDATE;
        IF v_spend + v_hold > p_monthly::numeric / 1000000 THEN
            RAISE EXCEPTION 'model usage monthly cap exceeded';
        END IF;
        UPDATE vc.month_cost_budget
           SET reserved_usd = reserved_usd + v_hold
         WHERE month_start = v_month;
        INSERT INTO vc.model_cost_reservation(
            owner_user_id, work_item_id, provider_attempt_id, provider_id, model_id,
            price_version, month_start, estimated_input_tokens, estimated_output_tokens,
            input_usd_per_1k, output_usd_per_1k, reserved_usd, purpose)
        VALUES (
            p_owner, NULL, p_attempt, p_provider, p_model,
            v_price.price_version, v_month, p_input, p_output,
            v_price.input_usd_per_1k, v_price.output_usd_per_1k, v_hold, p_purpose)
        RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT * INTO v_existing FROM vc.model_cost_reservation
         WHERE provider_attempt_id = p_attempt;
        IF v_existing.status = 'HELD'
           AND v_existing.owner_user_id = p_owner
           AND v_existing.purpose = p_purpose
           AND v_existing.provider_id = p_provider
           AND v_existing.model_id = p_model THEN
            RETURN QUERY SELECT v_existing.id, v_existing.purpose, v_existing.status,
                to_char(v_existing.reserved_usd, 'FM999999999999990.000000'),
                v_existing.provider_attempt_id;
            RETURN;
        END IF;
        RAISE EXCEPTION 'model usage reservation is not reusable';
    END;
    RETURN QUERY SELECT v_id, p_purpose, 'HELD'::text,
        to_char(v_hold, 'FM999999999999990.000000'), p_attempt;
END;
$$;

CREATE OR REPLACE FUNCTION vc.record_local_embedding_call(p_owner bigint)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    INSERT INTO vc.local_embedding_call(owner_user_id) VALUES (p_owner);
END;
$$;

CREATE OR REPLACE FUNCTION vc.apply_follow_up_due(
    p_owner bigint,
    p_id bigint,
    p_action text,
    p_deferred_until timestamptz)
    RETURNS TABLE(out_job bigint, out_created boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_relationship bigint;
    v_date date;
    v_time text;
    v_zone text;
    v_deferred timestamptz;
    v_trigger timestamptz;
    v_job bigint;
    v_enabled boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_action IS NULL OR p_action NOT IN ('leave', 'enqueue', 'silent', 'defer') THEN
        RAISE EXCEPTION 'follow_up: due action is not allowed';
    END IF;
    SELECT status, relationship_id, event_date, event_time, event_timezone, deferred_until
      INTO v_status, v_relationship, v_date, v_time, v_zone, v_deferred
      FROM vc.follow_up
     WHERE owner_user_id = p_owner AND id = p_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'follow_up: not found';
    END IF;
    IF p_action = 'leave' OR v_status NOT IN ('SCHEDULED', 'DEFERRED') THEN
        RETURN QUERY SELECT 0::bigint, false;
        RETURN;
    END IF;
    IF p_action = 'enqueue' THEN
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
        SELECT id INTO v_job
          FROM vc.work_item
         WHERE owner_user_id = p_owner
           AND kind = 'FOLLOW_UP'
           AND ref_id = p_id
           AND status IN ('PENDING', 'CLAIMED')
         ORDER BY id DESC
         LIMIT 1;
        IF v_job IS NOT NULL THEN
            RETURN QUERY SELECT v_job, false;
            RETURN;
        END IF;
        -- A closed policy does not enqueue and does not spend
        -- generation_deferrals. The row stays SCHEDULED or DEFERRED.
        SELECT enabled INTO v_enabled
          FROM vc.proactive_policy
         WHERE owner_user_id = p_owner AND relationship_id = v_relationship;
        IF NOT FOUND OR NOT COALESCE(v_enabled, false) THEN
            RETURN QUERY SELECT 0::bigint, false;
            RETURN;
        END IF;
        IF v_date IS NULL OR v_time IS NULL OR v_zone IS NULL OR btrim(v_zone) = '' THEN
            RAISE EXCEPTION 'follow_up: stored plan is incomplete';
        END IF;
        BEGIN
            v_trigger := (v_date + v_time::time) AT TIME ZONE btrim(v_zone);
        EXCEPTION
            WHEN invalid_parameter_value THEN
                RAISE EXCEPTION 'follow_up: stored plan is incomplete';
        END;
        UPDATE vc.follow_up
           SET status = 'SCHEDULED',
               trigger_at = v_trigger,
               deferred_until = NULL
         WHERE owner_user_id = p_owner AND id = p_id;
        v_job := nextval('vc.work_item_id_seq');
        BEGIN
            INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
            VALUES (p_owner, v_job, 'FOLLOW_UP', p_id, 'PENDING');
            RETURN QUERY SELECT v_job, true;
            RETURN;
        EXCEPTION
            WHEN unique_violation THEN
                SELECT id INTO v_job
                  FROM vc.work_item
                 WHERE owner_user_id = p_owner
                   AND kind = 'FOLLOW_UP'
                   AND ref_id = p_id
                   AND status IN ('PENDING', 'CLAIMED')
                 ORDER BY id DESC
                 LIMIT 1;
                IF v_job IS NULL THEN
                    RAISE;
                END IF;
                RETURN QUERY SELECT v_job, false;
                RETURN;
        END;
    ELSIF p_action = 'defer' THEN
        IF p_deferred_until IS NULL THEN
            RAISE EXCEPTION 'follow_up: deferred moment is required';
        END IF;
        IF v_status = 'DEFERRED' AND v_deferred IS NOT DISTINCT FROM p_deferred_until THEN
            RETURN QUERY SELECT 0::bigint, false;
            RETURN;
        END IF;
        UPDATE vc.follow_up
           SET status = 'DEFERRED',
               trigger_at = NULL,
               deferred_until = p_deferred_until
         WHERE owner_user_id = p_owner AND id = p_id;
        RETURN QUERY SELECT 0::bigint, false;
        RETURN;
    ELSIF p_action = 'silent' THEN
        UPDATE vc.follow_up
           SET status = 'SILENT',
               trigger_at = NULL,
               deferred_until = NULL
         WHERE owner_user_id = p_owner AND id = p_id;
        RETURN QUERY SELECT 0::bigint, false;
        RETURN;
    END IF;
    RAISE EXCEPTION 'follow_up: due action is not allowed';
END;
$$;

CREATE OR REPLACE FUNCTION vc.finish_follow_up_generation(
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
    p_params jsonb,
    p_now timestamptz DEFAULT NULL)
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
    v_now timestamptz;
    v_wait interval;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN
        RAISE EXCEPTION 'owner deletion is in progress';
    END IF;
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
               deferred_until = NULL,
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
               deferred_until = NULL,
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
               deferred_until = NULL,
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
               deferred_until = NULL,
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
    -- NOT_GENERATED and POLICY_DISABLED wait 6h, then 12h, then 24h.
    -- The same schedule is followDeferBase and followDeferLimit in the jobs
    -- package. A repeated finish while that hold is still stored does not
    -- move the instant or the count. The fourth failure is SILENT and keeps
    -- the reason. The event date, clock and timezone are not arguments.
    IF v_row.status IN ('DEFERRED', 'SILENT')
       AND v_row.generation_outcome IN ('NOT_GENERATED', 'POLICY_DISABLED') THEN
        RETURN;
    END IF;
    v_now := COALESCE(p_now, clock_timestamp());
    IF v_row.generation_deferrals >= 3 THEN
        UPDATE vc.follow_up
           SET status = 'SILENT',
               deliverable = 'NOT_DELIVERABLE',
               trigger_at = NULL,
               deferred_until = NULL,
               greeting_body = NULL,
               generation_outcome = p_outcome,
               generation_reason = p_reason,
               generation_provider_id = COALESCE(v_provider, generation_provider_id),
               generation_model_id = COALESCE(v_model, generation_model_id),
               generation_protocol = COALESCE(v_protocol, generation_protocol),
               generation_provider_revision = COALESCE(p_provider_revision, generation_provider_revision),
               generation_binding_revision = COALESCE(p_binding_revision, generation_binding_revision),
               generation_params = COALESCE(p_params, generation_params)
         WHERE owner_user_id = p_owner AND id = p_follow_up;
        RETURN;
    END IF;
    v_wait := CASE v_row.generation_deferrals
        WHEN 0 THEN interval '6 hours'
        WHEN 1 THEN interval '12 hours'
        ELSE interval '24 hours'
    END;
    UPDATE vc.follow_up
       SET status = 'DEFERRED',
           deliverable = 'NOT_DELIVERABLE',
           trigger_at = NULL,
           deferred_until = v_now + v_wait,
           generation_deferrals = generation_deferrals + 1,
           greeting_body = NULL,
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
