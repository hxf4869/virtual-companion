-- W09-S1: follow-up and per-character proactive policy.
-- V39 vc.reminder is intentionally unchanged (W11). Follow-ups are not written
-- by MemoryCore. needs_clarification and a date-only row without a confirmed
-- reminder rule cannot store a trigger instant. SCHEDULED is the only
-- triggerable status. Proactive policy defaults off; offline capability is
-- off until declared. Runtime roles read through FORCE RLS and write only
-- through these SECURITY DEFINER functions.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE vc.follow_up_id_seq AS bigint;

CREATE TABLE vc.proactive_policy (
    owner_user_id bigint NOT NULL,
    relationship_id bigint NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    quiet_hours_start time,
    quiet_hours_end time,
    quiet_hours_timezone text,
    daily_limit integer NOT NULL DEFAULT 0,
    recent_interaction_minutes integer NOT NULL DEFAULT 0,
    allowed_modes text[] NOT NULL DEFAULT ARRAY['COMPANION']::text[],
    offline_capable boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, relationship_id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT proactive_policy_daily_limit CHECK (daily_limit BETWEEN 0 AND 48),
    CONSTRAINT proactive_policy_recent_interaction CHECK (recent_interaction_minutes BETWEEN 0 AND 10080),
    CONSTRAINT proactive_policy_modes CHECK (
        cardinality(allowed_modes) BETWEEN 1 AND 2
        AND allowed_modes <@ ARRAY['COMPANION', 'STORY']::text[]),
    CONSTRAINT proactive_policy_quiet_hours CHECK (
        (quiet_hours_start IS NULL AND quiet_hours_end IS NULL AND quiet_hours_timezone IS NULL)
        OR (quiet_hours_start IS NOT NULL AND quiet_hours_end IS NOT NULL
            AND quiet_hours_timezone IS NOT NULL AND btrim(quiet_hours_timezone) <> ''))
);

CREATE TABLE vc.follow_up (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.follow_up_id_seq'),
    relationship_id bigint NOT NULL,
    memory_item_id bigint,
    source_ref text,
    source_revision bigint,
    body text NOT NULL,
    status text NOT NULL,
    normalization_status text NOT NULL,
    time_precision text,
    reminder_rule_confirmed boolean NOT NULL DEFAULT false,
    event_date date,
    event_time text,
    event_timezone text,
    trigger_at timestamptz,
    event_id text NOT NULL,
    deliverable text NOT NULL DEFAULT 'NOT_DELIVERABLE',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    cancelled_at timestamptz,
    PRIMARY KEY (owner_user_id, id),
    UNIQUE (owner_user_id, event_id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT follow_up_body_len CHECK (length(body) BETWEEN 1 AND 4000),
    CONSTRAINT follow_up_source_ref CHECK (
        source_ref IS NULL OR (length(source_ref) BETWEEN 1 AND 512 AND btrim(source_ref) <> '')),
    CONSTRAINT follow_up_status CHECK (status IN (
        'NEEDS_CLARIFICATION', 'SCHEDULED', 'ASKED', 'CANCELLED', 'SILENT',
        'DEFERRED', 'WAITING_HOST', 'BODY_READY')),
    CONSTRAINT follow_up_normalization CHECK (normalization_status IN (
        'explicit_date', 'normalized', 'needs_clarification', 'none')),
    CONSTRAINT follow_up_precision CHECK (time_precision IS NULL OR time_precision IN ('date', 'minute')),
    CONSTRAINT follow_up_event_time CHECK (
        event_time IS NULL OR event_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT follow_up_date_has_no_clock CHECK (time_precision IS DISTINCT FROM 'date' OR event_time IS NULL),
    CONSTRAINT follow_up_deliverable CHECK (deliverable IN ('NOT_DELIVERABLE', 'DELIVERABLE')),
    CONSTRAINT follow_up_scheduled_iff_trigger CHECK ((status = 'SCHEDULED') = (trigger_at IS NOT NULL)),
    CONSTRAINT follow_up_trigger_moment CHECK (
        trigger_at IS NULL
        OR (
            normalization_status <> 'needs_clarification'
            AND status <> 'NEEDS_CLARIFICATION'
            AND event_timezone IS NOT NULL
            AND btrim(event_timezone) <> ''
            AND (
                (time_precision = 'minute' AND event_time IS NOT NULL)
                OR (time_precision = 'date' AND reminder_rule_confirmed AND event_time IS NULL)
            )
        ))
);

ALTER TABLE vc.proactive_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.proactive_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.follow_up ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.follow_up FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.proactive_policy FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.follow_up FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE ALL ON vc.proactive_policy, vc.follow_up, vc.follow_up_id_seq FROM PUBLIC;
GRANT SELECT ON vc.proactive_policy, vc.follow_up TO vc_api, vc_worker;
GRANT USAGE, SELECT ON SEQUENCE vc.follow_up_id_seq TO vc_api, vc_worker;

CREATE FUNCTION vc.put_proactive_policy(
    p_owner bigint,
    p_relationship bigint,
    p_enabled boolean,
    p_quiet_start text,
    p_quiet_end text,
    p_quiet_timezone text,
    p_daily_limit integer,
    p_recent_interaction_minutes integer,
    p_allowed_modes text[],
    p_offline_capable boolean)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_start time;
    v_end time;
    v_zone text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_enabled IS NULL OR p_offline_capable IS NULL THEN
        RAISE EXCEPTION 'proactive_policy: enabled and offline capability are required';
    END IF;
    IF p_daily_limit IS NULL OR p_daily_limit < 0 OR p_daily_limit > 48
       OR p_recent_interaction_minutes IS NULL OR p_recent_interaction_minutes < 0
       OR p_recent_interaction_minutes > 10080 THEN
        RAISE EXCEPTION 'proactive_policy: limit out of range';
    END IF;
    IF p_allowed_modes IS NULL OR cardinality(p_allowed_modes) NOT BETWEEN 1 AND 2
       OR NOT p_allowed_modes <@ ARRAY['COMPANION', 'STORY']::text[] THEN
        RAISE EXCEPTION 'proactive_policy: allowed modes must be COMPANION and/or STORY';
    END IF;
    v_zone := NULLIF(btrim(p_quiet_timezone), '');
    v_start := CASE WHEN p_quiet_start IS NULL OR btrim(p_quiet_start) = '' THEN NULL ELSE p_quiet_start::time END;
    v_end := CASE WHEN p_quiet_end IS NULL OR btrim(p_quiet_end) = '' THEN NULL ELSE p_quiet_end::time END;
    IF (v_start IS NULL AND v_end IS NULL AND v_zone IS NULL)
       OR (v_start IS NOT NULL AND v_end IS NOT NULL AND v_zone IS NOT NULL) THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'proactive_policy: quiet hours require start, end and timezone';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.relationship
         WHERE owner_user_id = p_owner AND id = p_relationship) THEN
        RAISE EXCEPTION 'proactive_policy: relationship not found';
    END IF;
    INSERT INTO vc.proactive_policy(
        owner_user_id, relationship_id, enabled, quiet_hours_start, quiet_hours_end,
        quiet_hours_timezone, daily_limit, recent_interaction_minutes, allowed_modes,
        offline_capable)
    VALUES (
        p_owner, p_relationship, p_enabled, v_start, v_end, v_zone, p_daily_limit,
        p_recent_interaction_minutes, p_allowed_modes, p_offline_capable)
    ON CONFLICT (owner_user_id, relationship_id) DO UPDATE
        SET enabled = EXCLUDED.enabled,
            quiet_hours_start = EXCLUDED.quiet_hours_start,
            quiet_hours_end = EXCLUDED.quiet_hours_end,
            quiet_hours_timezone = EXCLUDED.quiet_hours_timezone,
            daily_limit = EXCLUDED.daily_limit,
            recent_interaction_minutes = EXCLUDED.recent_interaction_minutes,
            allowed_modes = EXCLUDED.allowed_modes,
            offline_capable = EXCLUDED.offline_capable,
            updated_at = clock_timestamp();
END;
$$;

CREATE FUNCTION vc.get_proactive_policy(p_owner bigint, p_relationship bigint)
    RETURNS TABLE(
        out_enabled boolean,
        out_quiet_start time,
        out_quiet_end time,
        out_quiet_timezone text,
        out_daily_limit integer,
        out_recent_interaction_minutes integer,
        out_allowed_modes text[],
        out_offline_capable boolean)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
    SELECT COALESCE(p.enabled, false),
           p.quiet_hours_start,
           p.quiet_hours_end,
           p.quiet_hours_timezone,
           COALESCE(p.daily_limit, 0),
           COALESCE(p.recent_interaction_minutes, 0),
           COALESCE(p.allowed_modes, ARRAY['COMPANION']::text[]),
           COALESCE(p.offline_capable, false)
      FROM vc.relationship r
      LEFT JOIN vc.proactive_policy p
        ON (p.owner_user_id, p.relationship_id) = (r.owner_user_id, r.id)
     WHERE r.owner_user_id = p_owner AND r.id = p_relationship;
END;
$$;

CREATE FUNCTION vc.insert_follow_up(
    p_owner bigint,
    p_relationship bigint,
    p_memory_item_id bigint,
    p_source_ref text,
    p_source_revision bigint,
    p_body text,
    p_status text,
    p_normalization_status text,
    p_time_precision text,
    p_reminder_rule_confirmed boolean,
    p_event_date date,
    p_event_time text,
    p_event_timezone text,
    p_trigger_at timestamptz)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_rule boolean := COALESCE(p_reminder_rule_confirmed, false);
    v_triggerable boolean;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_body IS NULL OR btrim(p_body) = '' OR length(p_body) > 4000 THEN
        RAISE EXCEPTION 'follow_up: body must be 1..4000 characters';
    END IF;
    IF p_status IS NULL OR p_status NOT IN (
        'NEEDS_CLARIFICATION', 'SCHEDULED', 'ASKED', 'CANCELLED', 'SILENT',
        'DEFERRED', 'WAITING_HOST', 'BODY_READY') THEN
        RAISE EXCEPTION 'follow_up: status is not allowed';
    END IF;
    IF p_normalization_status IS NULL OR p_normalization_status NOT IN (
        'explicit_date', 'normalized', 'needs_clarification', 'none') THEN
        RAISE EXCEPTION 'follow_up: normalization status is not allowed';
    END IF;
    IF p_time_precision IS NOT NULL AND p_time_precision NOT IN ('date', 'minute') THEN
        RAISE EXCEPTION 'follow_up: time precision is not allowed';
    END IF;
    IF p_source_ref IS NOT NULL AND (btrim(p_source_ref) = '' OR length(p_source_ref) > 512) THEN
        RAISE EXCEPTION 'follow_up: source ref is invalid';
    END IF;
    v_triggerable := p_status = 'SCHEDULED' OR p_trigger_at IS NOT NULL;
    IF v_triggerable AND (p_normalization_status = 'needs_clarification' OR p_status = 'NEEDS_CLARIFICATION') THEN
        RAISE EXCEPTION 'follow_up: needs_clarification cannot be triggerable';
    END IF;
    IF v_triggerable AND p_time_precision = 'date' AND NOT v_rule THEN
        RAISE EXCEPTION 'follow_up: date-only moment requires a confirmed reminder rule';
    END IF;
    IF v_triggerable AND p_time_precision = 'minute' AND (p_event_time IS NULL OR p_event_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN
        RAISE EXCEPTION 'follow_up: minute precision requires event_time';
    END IF;
    IF v_triggerable AND p_time_precision = 'date' AND p_event_time IS NOT NULL THEN
        RAISE EXCEPTION 'follow_up: a date has no clock time';
    END IF;
    IF v_triggerable AND (p_event_timezone IS NULL OR btrim(p_event_timezone) = '') THEN
        RAISE EXCEPTION 'follow_up: trigger moment requires a timezone';
    END IF;
    IF v_triggerable AND p_time_precision IS DISTINCT FROM 'minute'
       AND NOT (p_time_precision = 'date' AND v_rule) THEN
        RAISE EXCEPTION 'follow_up: trigger moment is not explicit';
    END IF;
    IF (p_status = 'SCHEDULED') <> (p_trigger_at IS NOT NULL) THEN
        RAISE EXCEPTION 'follow_up: scheduled rows require a trigger moment';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM vc.relationship
         WHERE owner_user_id = p_owner AND id = p_relationship) THEN
        RAISE EXCEPTION 'follow_up: relationship not found';
    END IF;
    v_id := nextval('vc.follow_up_id_seq');
    INSERT INTO vc.follow_up(
        owner_user_id, id, relationship_id, memory_item_id, source_ref, source_revision,
        body, status, normalization_status, time_precision, reminder_rule_confirmed,
        event_date, event_time, event_timezone, trigger_at, event_id)
    VALUES (
        p_owner, v_id, p_relationship, p_memory_item_id, NULLIF(btrim(p_source_ref), ''),
        p_source_revision, btrim(p_body), p_status, p_normalization_status, p_time_precision,
        v_rule, p_event_date, p_event_time, NULLIF(btrim(p_event_timezone), ''), p_trigger_at,
        'fu-' || v_id::text);
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.list_follow_ups(p_owner bigint, p_relationship bigint)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_status text, out_body text, out_trigger_at timestamptz)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
    SELECT f.id, f.relationship_id, f.status, f.body, f.trigger_at
      FROM vc.follow_up f
     WHERE f.owner_user_id = p_owner
       AND (p_relationship IS NULL OR f.relationship_id = p_relationship)
     ORDER BY f.id;
END;
$$;

CREATE FUNCTION vc.get_follow_up(p_owner bigint, p_id bigint)
    RETURNS TABLE(
        out_id bigint,
        out_relationship_id bigint,
        out_status text,
        out_body text,
        out_normalization_status text,
        out_time_precision text,
        out_reminder_rule_confirmed boolean,
        out_event_date date,
        out_event_time text,
        out_event_timezone text,
        out_trigger_at timestamptz,
        out_event_id text,
        out_deliverable text)
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
    SELECT f.id, f.relationship_id, f.status, f.body, f.normalization_status, f.time_precision,
           f.reminder_rule_confirmed, f.event_date, f.event_time, f.event_timezone, f.trigger_at,
           f.event_id, f.deliverable
      FROM vc.follow_up f
     WHERE f.owner_user_id = p_owner AND f.id = p_id;
END;
$$;

CREATE FUNCTION vc.cancel_follow_up(p_owner bigint, p_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT status INTO v_status
      FROM vc.follow_up
     WHERE owner_user_id = p_owner AND id = p_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RETURN false;
    END IF;
    IF v_status <> 'CANCELLED' THEN
        UPDATE vc.follow_up
           SET status = 'CANCELLED', trigger_at = NULL, cancelled_at = clock_timestamp()
         WHERE owner_user_id = p_owner AND id = p_id;
        UPDATE vc.work_item
           SET status = 'CANCELLED',
               claim_token = NULL,
               claim_fence = NULL,
               lease_expires_at = NULL,
               finished_at = clock_timestamp()
         WHERE owner_user_id = p_owner
           AND kind = 'FOLLOW_UP'
           AND ref_id = p_id
           AND status IN ('PENDING', 'CLAIMED');
    END IF;
    RETURN true;
END;
$$;

CREATE FUNCTION vc.enqueue_follow_up(p_owner bigint, p_id bigint)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_job bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF NOT EXISTS (
        SELECT 1 FROM vc.follow_up
         WHERE owner_user_id = p_owner AND id = p_id
           AND status = 'SCHEDULED' AND trigger_at IS NOT NULL) THEN
        RAISE EXCEPTION 'follow_up: only a scheduled follow-up can be queued';
    END IF;
    SELECT id INTO v_job
      FROM vc.work_item
     WHERE owner_user_id = p_owner AND kind = 'FOLLOW_UP' AND ref_id = p_id
       AND status IN ('PENDING', 'CLAIMED')
     ORDER BY id DESC
     LIMIT 1;
    IF FOUND THEN
        RETURN v_job;
    END IF;
    v_job := nextval('vc.work_item_id_seq');
    INSERT INTO vc.work_item(owner_user_id, id, kind, ref_id, status)
    VALUES (p_owner, v_job, 'FOLLOW_UP', p_id, 'PENDING');
    RETURN v_job;
END;
$$;

REVOKE ALL ON FUNCTION
    vc.put_proactive_policy(bigint, bigint, boolean, text, text, text, integer, integer, text[], boolean),
    vc.get_proactive_policy(bigint, bigint),
    vc.insert_follow_up(bigint, bigint, bigint, text, bigint, text, text, text, text, boolean, date, text, text, timestamptz),
    vc.list_follow_ups(bigint, bigint),
    vc.get_follow_up(bigint, bigint),
    vc.cancel_follow_up(bigint, bigint),
    vc.enqueue_follow_up(bigint, bigint)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.put_proactive_policy(bigint, bigint, boolean, text, text, text, integer, integer, text[], boolean),
    vc.get_proactive_policy(bigint, bigint),
    vc.insert_follow_up(bigint, bigint, bigint, text, bigint, text, text, text, text, boolean, date, text, text, timestamptz),
    vc.list_follow_ups(bigint, bigint),
    vc.get_follow_up(bigint, bigint),
    vc.cancel_follow_up(bigint, bigint),
    vc.enqueue_follow_up(bigint, bigint)
    TO vc_api, vc_worker;

-- Claim the follow-up kind with the default lease. Signature stays the
-- six-argument form so existing callers keep working. A job is claimable only
-- while its follow-up is still SCHEDULED.
CREATE OR REPLACE FUNCTION vc.go_claim_jobs(
    p_generation_lease_seconds integer,
    p_export_lease_seconds integer,
    p_default_lease_seconds integer,
    p_limit integer,
    p_generation_limit integer,
    p_extract_limit integer)
    RETURNS TABLE(
        out_owner_user_id bigint,
        out_job_id bigint,
        out_kind text,
        out_ref_id bigint,
        out_claim_token text,
        out_claim_fence text,
        out_lease_seconds integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit integer;
    v_gen_limit integer;
    v_extract_limit integer;
BEGIN
    IF p_generation_lease_seconds IS NULL OR p_generation_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: generation lease must be >= 5s';
    END IF;
    IF p_export_lease_seconds IS NULL OR p_export_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: export lease must be >= 5s';
    END IF;
    IF p_default_lease_seconds IS NULL OR p_default_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: default lease must be >= 5s';
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
    v_gen_limit := CASE
        WHEN p_generation_limit IS NULL THEN NULL
        ELSE GREATEST(p_generation_limit, 0)
    END;
    v_extract_limit := CASE
        WHEN p_extract_limit IS NULL THEN NULL
        ELSE GREATEST(p_extract_limit, 0)
    END;

    RETURN QUERY
    WITH gen_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'GENERATION'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_gen_limit
    ),
    export_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'DATA_EXPORT'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ),
    extract_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'ST_MEMORY_EXTRACT'
           AND (EXISTS (SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id = wi.owner_user_id AND s.id = wi.ref_id AND s.settled))
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_extract_limit
    ),
    follow_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'FOLLOW_UP'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
           AND EXISTS (
               SELECT 1 FROM vc.follow_up f
                WHERE f.owner_user_id = wi.owner_user_id
                  AND f.id = wi.ref_id
                  AND f.status = 'SCHEDULED'
                  AND f.trigger_at IS NOT NULL)
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ),
    picked AS (
        SELECT owner_user_id, id
          FROM (
              SELECT * FROM gen_picked
              UNION ALL SELECT * FROM export_picked
              UNION ALL SELECT * FROM extract_picked
              UNION ALL SELECT * FROM follow_picked
          ) u
         ORDER BY created_at, id
         LIMIT v_limit
    )
    UPDATE vc.work_item wi
       SET status = 'CLAIMED',
           claim_token = gen_random_uuid()::text,
           claim_fence = gen_random_uuid()::text,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs =>
               CASE wi.kind
                   WHEN 'GENERATION' THEN p_generation_lease_seconds
                   WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                   WHEN 'FOLLOW_UP' THEN p_default_lease_seconds
                   ELSE p_default_lease_seconds
               END)
      FROM picked p
     WHERE wi.owner_user_id = p.owner_user_id AND wi.id = p.id
    RETURNING wi.owner_user_id, wi.id, wi.kind, wi.ref_id, wi.claim_token, wi.claim_fence,
              CASE wi.kind
                  WHEN 'GENERATION' THEN p_generation_lease_seconds
                  WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                  WHEN 'FOLLOW_UP' THEN p_default_lease_seconds
                  ELSE p_default_lease_seconds
              END;
END;
$$;

ALTER FUNCTION vc.export_v2_owner_metadata(bigint) RENAME TO export_v2_owner_metadata_v153;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint)
    RETURNS jsonb
    LANGUAGE plpgsql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_v153(p_owner) || jsonb_build_object(
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
                'deliverable', f.deliverable
            ) ORDER BY f.id)
              FROM vc.follow_up f
             WHERE f.owner_user_id = p_owner), '[]'::jsonb),
        'proactivePolicies', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'relationshipId', p.relationship_id::text,
                'enabled', p.enabled,
                'quietHoursStart', to_char(p.quiet_hours_start, 'HH24:MI'),
                'quietHoursEnd', to_char(p.quiet_hours_end, 'HH24:MI'),
                'quietHoursTimezone', p.quiet_hours_timezone,
                'dailyLimit', p.daily_limit,
                'recentInteractionMinutes', p.recent_interaction_minutes,
                'allowedModes', to_jsonb(p.allowed_modes),
                'offlineCapable', p.offline_capable
            ) ORDER BY p.relationship_id)
              FROM vc.proactive_policy p
             WHERE p.owner_user_id = p_owner), '[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint), vc.export_v2_owner_metadata_v153(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_v153(bigint) FROM vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api, vc_worker;
