-- W09-S3: a due follow-up is deferred, left silent, or given one FOLLOW_UP job.
-- DEFERRED stores the next absolute instant and clears trigger_at. The event
-- date, clock and timezone stay as stored. A later enqueue rebuilds trigger_at
-- from those columns in the event timezone, so the server TimeZone cannot move
-- the plan. V39 vc.reminder is unchanged. This pass does not write a greeting.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.follow_up
    ADD COLUMN deferred_until timestamptz,
    ADD CONSTRAINT follow_up_deferred_until CHECK (
        (status = 'DEFERRED') = (deferred_until IS NOT NULL));

-- One live job per follow-up. CANCELLED jobs drop out so a cancelled row can
-- be told apart from a job that is still pending, claimed, done or failed.
CREATE UNIQUE INDEX follow_up_one_live_job
    ON vc.work_item (owner_user_id, ref_id)
    WHERE kind = 'FOLLOW_UP' AND status <> 'CANCELLED';

CREATE FUNCTION vc.follow_up_zone(p_zone text)
    RETURNS text
    LANGUAGE plpgsql
    STABLE
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_zone text := NULLIF(btrim(p_zone), '');
BEGIN
    IF v_zone IS NULL THEN
        RETURN 'UTC';
    END IF;
    BEGIN
        PERFORM (TIMESTAMP '2000-01-01 00:00:00' AT TIME ZONE v_zone);
    EXCEPTION
        WHEN invalid_parameter_value THEN
            RETURN 'UTC';
    END;
    RETURN v_zone;
END;
$$;

CREATE FUNCTION vc.list_follow_up_sync_targets()
    RETURNS TABLE(out_owner bigint, out_relationship bigint)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT owner_user_id, relationship_id
      FROM (
            SELECT m.owner_user_id, m.relationship_id
              FROM vc.memory_item m
             WHERE m.status = 'ACCEPTED'
               AND m.deleted_at IS NULL
            UNION
            SELECT f.owner_user_id, f.relationship_id
              FROM vc.follow_up f
             WHERE f.status <> 'CANCELLED'
      ) targets
     ORDER BY owner_user_id, relationship_id;
$$;

CREATE FUNCTION vc.list_due_follow_ups(p_now timestamptz)
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
                  AND w.status <> 'CANCELLED'),
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

CREATE FUNCTION vc.apply_follow_up_due(
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
           AND status <> 'CANCELLED'
         ORDER BY id DESC
         LIMIT 1;
        IF v_job IS NOT NULL THEN
            RETURN QUERY SELECT v_job, false;
            RETURN;
        END IF;
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
                   AND status <> 'CANCELLED'
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

REVOKE ALL ON FUNCTION
    vc.follow_up_zone(text),
    vc.list_follow_up_sync_targets(),
    vc.list_due_follow_ups(timestamptz),
    vc.apply_follow_up_due(bigint, bigint, text, timestamptz)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.list_follow_up_sync_targets(),
    vc.list_due_follow_ups(timestamptz),
    vc.apply_follow_up_due(bigint, bigint, text, timestamptz)
    TO vc_worker;
