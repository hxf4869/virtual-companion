-- W09-S5: a follow-up that could not be generated waits and can be queued
-- again. The partial unique index admits one PENDING or CLAIMED FOLLOW_UP job.
-- DONE, FAILED, DEAD_LETTERED and CANCELLED do not keep the row out of the
-- queue. NOT_GENERATED and POLICY_DISABLED wait 6 hours, then 12, then 24,
-- and the fourth failure is SILENT. That schedule matches followDeferBase and
-- followDeferLimit in the jobs package. A closed policy is not a failed
-- greeting: list and apply leave the current SCHEDULED or DEFERRED row and do
-- not spend generation_deferrals. The event date, clock and timezone stay as
-- stored. V39 vc.reminder is unchanged.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.follow_up
    ADD COLUMN generation_deferrals integer NOT NULL DEFAULT 0;

-- Rows already marked not-generated were left SCHEDULED with a finished job.
-- Give them the first wait so the new hold check can be installed.
UPDATE vc.follow_up
   SET status = 'DEFERRED',
       trigger_at = NULL,
       deferred_until = COALESCE(deferred_until, clock_timestamp() + interval '6 hours'),
       generation_deferrals = GREATEST(generation_deferrals, 1)
 WHERE generation_outcome IN ('NOT_GENERATED', 'POLICY_DISABLED')
   AND status NOT IN ('DEFERRED', 'SILENT');

-- SCHEDULED stays allowed: a retry enqueue keeps the previous outcome while
-- the new live job runs. Finish is what moves the row to DEFERRED or SILENT.
ALTER TABLE vc.follow_up
    ADD CONSTRAINT follow_up_generation_deferrals_range
        CHECK (generation_deferrals BETWEEN 0 AND 3),
    ADD CONSTRAINT follow_up_generation_hold
        CHECK (
            generation_outcome IS NULL
            OR generation_outcome NOT IN ('NOT_GENERATED', 'POLICY_DISABLED')
            OR status IN ('SCHEDULED', 'DEFERRED', 'SILENT'));

DROP INDEX vc.follow_up_one_live_job;
CREATE UNIQUE INDEX follow_up_one_live_job
    ON vc.work_item (owner_user_id, ref_id)
    WHERE kind = 'FOLLOW_UP' AND status IN ('PENDING', 'CLAIMED');

-- out_queued is true only while a live job exists. sent_today still counts
-- every other non-cancelled FOLLOW_UP job in the user's day.
CREATE OR REPLACE FUNCTION vc.list_due_follow_ups(p_now timestamptz)
    RETURNS TABLE(
        out_owner bigint,
        out_id bigint,
        out_relationship bigint,
        out_status text,
        out_event_date text,
        out_event_time text,
        out_event_timezone text,
        out_trigger_at timestamptz,
        out_deferred_until timestamptz,
        out_source_ref text,
        out_enabled boolean,
        out_quiet_start text,
        out_quiet_end text,
        out_quiet_timezone text,
        out_daily_limit integer,
        out_recent_minutes integer,
        out_allowed_modes text[],
        out_mode text,
        out_changed boolean,
        out_last_interaction timestamptz,
        out_sent_today integer,
        out_queued boolean,
        out_asked boolean)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT f.owner_user_id,
           f.id,
           f.relationship_id,
           f.status,
           to_char(f.event_date, 'YYYY-MM-DD'),
           f.event_time,
           f.event_timezone,
           f.trigger_at,
           f.deferred_until,
           f.source_ref,
           COALESCE(p.enabled, false),
           to_char(p.quiet_hours_start, 'HH24:MI'),
           to_char(p.quiet_hours_end, 'HH24:MI'),
           p.quiet_hours_timezone,
           COALESCE(p.daily_limit, 0),
           COALESCE(p.recent_interaction_minutes, 0),
           p.allowed_modes,
           COALESCE(mode.st_mode, ''),
           NOT EXISTS (
               SELECT 1
                 FROM vc.st_message_source s
                 JOIN vc.conversation c
                   ON (c.owner_user_id, c.id) = (s.owner_user_id, s.conversation_id)
                WHERE s.owner_user_id = f.owner_user_id
                  AND f.source_ref IS NOT NULL
                  AND s.source_ref = f.source_ref
                  AND c.relationship_id = f.relationship_id
                  AND c.st_source_state = 'PRESENT'
                  AND NOT c.incognito
                  AND s.present AND s.settled AND s.eligible AND NOT s.suppressed
                  AND (f.source_revision IS NULL OR s.source_revision = f.source_revision)),
           talk.last_at,
           (
               SELECT count(DISTINCT w.ref_id)::integer
                 FROM vc.work_item w
                 JOIN vc.follow_up other
                   ON other.owner_user_id = w.owner_user_id
                  AND other.id = w.ref_id
                WHERE w.owner_user_id = f.owner_user_id
                  AND other.relationship_id = f.relationship_id
                  AND w.kind = 'FOLLOW_UP'
                  AND w.status <> 'CANCELLED'
                  AND w.ref_id <> f.id
                  AND w.created_at >= (date_trunc('day', p_now AT TIME ZONE z.zone) AT TIME ZONE z.zone)
                  AND w.created_at < (date_trunc('day', p_now AT TIME ZONE z.zone) AT TIME ZONE z.zone) + interval '1 day'
           ),
           EXISTS (
               SELECT 1
                 FROM vc.work_item w
                WHERE w.owner_user_id = f.owner_user_id
                  AND w.kind = 'FOLLOW_UP'
                  AND w.ref_id = f.id
                  AND w.status IN ('PENDING', 'CLAIMED')),
           f.status = 'ASKED'
      FROM vc.follow_up f
      LEFT JOIN vc.proactive_policy p
        ON (p.owner_user_id, p.relationship_id) = (f.owner_user_id, f.relationship_id)
      CROSS JOIN LATERAL (
          SELECT vc.follow_up_zone(COALESCE(p.quiet_hours_timezone, f.event_timezone)) AS zone
      ) z
      LEFT JOIN LATERAL (
          SELECT c.st_mode
            FROM vc.st_message_source s
            JOIN vc.conversation c
              ON (c.owner_user_id, c.id) = (s.owner_user_id, s.conversation_id)
           WHERE s.owner_user_id = f.owner_user_id
             AND f.source_ref IS NOT NULL
             AND s.source_ref = f.source_ref
           ORDER BY s.id
           LIMIT 1
      ) mode ON true
      LEFT JOIN LATERAL (
          SELECT max(s.source_timestamp) AS last_at
            FROM vc.st_message_source s
            JOIN vc.conversation c
              ON (c.owner_user_id, c.id) = (s.owner_user_id, s.conversation_id)
           WHERE s.owner_user_id = f.owner_user_id
             AND c.relationship_id = f.relationship_id
             AND s.role = 'user'
      ) talk ON true
     WHERE (f.status = 'SCHEDULED' AND f.trigger_at <= p_now)
        OR (f.status = 'DEFERRED' AND f.deferred_until <= p_now)
     ORDER BY COALESCE(f.trigger_at, f.deferred_until), f.id;
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

DROP FUNCTION vc.finish_follow_up_generation(
    bigint, bigint, text, text, text, text, text, text, bigint, bigint, jsonb);

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

REVOKE ALL ON FUNCTION vc.finish_follow_up_generation(
    bigint, bigint, text, text, text, text, text, text, bigint, bigint, jsonb, timestamptz)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.finish_follow_up_generation(
    bigint, bigint, text, text, text, text, text, text, bigint, bigint, jsonb, timestamptz)
    TO vc_api, vc_worker;
