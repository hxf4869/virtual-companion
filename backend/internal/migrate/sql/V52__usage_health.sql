-- USAGE-HEALTH V52: continuous-use reminder prefs + trusted heartbeat
-- (§20.7 / 21.3.3). The backend computes continuous minutes; the client only
-- assists. Reminders are system-layer facts, never role-played. Approved
-- reminder intervals are 60/90/120/180 minutes (default 120); the gap that
-- starts a new continuous session is 15/30/45 minutes (default 30).

SET search_path TO vc, pg_catalog;

CREATE TABLE IF NOT EXISTS vc.usage_health_prefs (
    owner_user_id           bigint      PRIMARY KEY,
    reminder_after_minutes  integer     NOT NULL DEFAULT 120,
    session_gap_minutes     integer     NOT NULL DEFAULT 30,
    updated_at              timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT usage_health_reminder_chk
        CHECK (reminder_after_minutes IN (60, 90, 120, 180)),
    CONSTRAINT usage_health_gap_chk
        CHECK (session_gap_minutes IN (15, 30, 45))
);

CREATE TABLE IF NOT EXISTS vc.usage_session (
    owner_user_id      bigint      PRIMARY KEY,
    session_started_at timestamptz NOT NULL,
    last_activity_at   timestamptz NOT NULL,
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE
);

CREATE SEQUENCE IF NOT EXISTS vc.usage_reminder_event_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.usage_reminder_event_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.usage_reminder_event (
    owner_user_id       bigint      NOT NULL,
    id                  bigint      NOT NULL,
    reminded_at         timestamptz NOT NULL DEFAULT now(),
    continuous_minutes  integer     NOT NULL,
    result              text        NOT NULL,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT usage_reminder_result_chk
        CHECK (result IN ('SHOWN', 'CONTINUED', 'ENDED')),
    CONSTRAINT usage_reminder_minutes_nonneg
        CHECK (continuous_minutes >= 0)
);

ALTER TABLE vc.usage_health_prefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.usage_health_prefs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.usage_health_prefs;
CREATE POLICY owner_isolation ON vc.usage_health_prefs FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

ALTER TABLE vc.usage_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.usage_session FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.usage_session;
CREATE POLICY owner_isolation ON vc.usage_session FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

ALTER TABLE vc.usage_reminder_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.usage_reminder_event FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.usage_reminder_event;
CREATE POLICY owner_isolation ON vc.usage_reminder_event FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

CREATE OR REPLACE FUNCTION vc.usage_health_compute(
    p_owner_user_id bigint,
    p_now           timestamptz,
    p_mutate        boolean
)
    RETURNS TABLE(
        out_reminder_after_minutes integer,
        out_session_gap_minutes    integer,
        out_continuous_minutes     integer,
        out_reminder_due           boolean,
        out_session_started_at     timestamptz
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_now      timestamptz := COALESCE(p_now, clock_timestamp());
    v_after    integer := 120;
    v_gap      integer := 30;
    v_started  timestamptz;
    v_last     timestamptz;
    v_cont     integer := 0;
    v_due      boolean := false;
    v_count    integer := 0;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'usage_health: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'usage_health: owner_user_id must match server-trusted context';
    END IF;

    SELECT reminder_after_minutes, session_gap_minutes
      INTO v_after, v_gap
      FROM vc.usage_health_prefs
     WHERE owner_user_id = p_owner_user_id;
    IF NOT FOUND THEN
        v_after := 120;
        v_gap := 30;
    END IF;

    SELECT session_started_at, last_activity_at
      INTO v_started, v_last
      FROM vc.usage_session
     WHERE owner_user_id = p_owner_user_id;

    IF v_started IS NULL THEN
        IF p_mutate THEN
            INSERT INTO vc.usage_session(owner_user_id, session_started_at, last_activity_at)
            VALUES (p_owner_user_id, v_now, v_now);
            v_started := v_now;
            v_last := v_now;
        END IF;
    ELSIF extract(epoch FROM (v_now - v_last)) > (v_gap * 60) THEN
        IF p_mutate THEN
            UPDATE vc.usage_session
               SET session_started_at = v_now, last_activity_at = v_now
             WHERE owner_user_id = p_owner_user_id;
            v_started := v_now;
            v_last := v_now;
        ELSE
            v_started := NULL;
        END IF;
    ELSIF p_mutate THEN
        UPDATE vc.usage_session
           SET last_activity_at = v_now
         WHERE owner_user_id = p_owner_user_id;
        v_last := v_now;
    END IF;

    IF v_started IS NOT NULL THEN
        v_cont := GREATEST(0, floor(extract(epoch FROM (v_now - v_started)) / 60)::integer);
        -- Only CONTINUED defers the next reminder. SHOWN is an audit
        -- fact and must leave reminderDue true until the user continues.
        SELECT count(*) INTO v_count
          FROM vc.usage_reminder_event e
         WHERE e.owner_user_id = p_owner_user_id
           AND e.reminded_at >= v_started
           AND e.result = 'CONTINUED';
        v_due := v_cont >= v_after * (v_count + 1);
    END IF;

    out_reminder_after_minutes := v_after;
    out_session_gap_minutes := v_gap;
    out_continuous_minutes := v_cont;
    out_reminder_due := v_due;
    out_session_started_at := v_started;
    RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION vc.get_usage_health(
    p_owner_user_id bigint,
    p_now           timestamptz DEFAULT NULL
)
    RETURNS TABLE(
        out_reminder_after_minutes integer,
        out_session_gap_minutes    integer,
        out_continuous_minutes     integer,
        out_reminder_due           boolean,
        out_session_started_at     timestamptz
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT * FROM vc.usage_health_compute(p_owner_user_id, p_now, false);
$$;

CREATE OR REPLACE FUNCTION vc.usage_heartbeat(
    p_owner_user_id bigint,
    p_now           timestamptz DEFAULT NULL
)
    RETURNS TABLE(
        out_reminder_after_minutes integer,
        out_session_gap_minutes    integer,
        out_continuous_minutes     integer,
        out_reminder_due           boolean,
        out_session_started_at     timestamptz
    )
    LANGUAGE sql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT * FROM vc.usage_health_compute(p_owner_user_id, p_now, true);
$$;

CREATE OR REPLACE FUNCTION vc.update_usage_health_prefs(
    p_owner_user_id          bigint,
    p_reminder_after_minutes integer,
    p_session_gap_minutes    integer
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'update_usage_health_prefs: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'update_usage_health_prefs: owner_user_id must match server-trusted context';
    END IF;
    IF p_reminder_after_minutes IS NULL
       OR p_reminder_after_minutes NOT IN (60, 90, 120, 180) THEN
        RAISE EXCEPTION 'update_usage_health_prefs: unapproved reminder_after_minutes';
    END IF;
    IF p_session_gap_minutes IS NULL
       OR p_session_gap_minutes NOT IN (15, 30, 45) THEN
        RAISE EXCEPTION 'update_usage_health_prefs: unapproved session_gap_minutes';
    END IF;

    INSERT INTO vc.usage_health_prefs(
        owner_user_id, reminder_after_minutes, session_gap_minutes, updated_at)
    VALUES (p_owner_user_id, p_reminder_after_minutes, p_session_gap_minutes, now())
    ON CONFLICT (owner_user_id) DO UPDATE
        SET reminder_after_minutes = EXCLUDED.reminder_after_minutes,
            session_gap_minutes = EXCLUDED.session_gap_minutes,
            updated_at = now();
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION vc.record_usage_reminder(
    p_owner_user_id bigint,
    p_result        text,
    p_now           timestamptz DEFAULT NULL
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_now  timestamptz := COALESCE(p_now, clock_timestamp());
    v_id   bigint;
    v_cont integer;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'record_usage_reminder: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'record_usage_reminder: owner_user_id must match server-trusted context';
    END IF;
    IF p_result IS NULL OR p_result NOT IN ('SHOWN', 'CONTINUED', 'ENDED') THEN
        RAISE EXCEPTION 'record_usage_reminder: unapproved result';
    END IF;

    SELECT out_continuous_minutes INTO v_cont
      FROM vc.usage_health_compute(p_owner_user_id, v_now, false);
    v_id := nextval('vc.usage_reminder_event_id_seq');
    INSERT INTO vc.usage_reminder_event(
        owner_user_id, id, reminded_at, continuous_minutes, result)
    VALUES (p_owner_user_id, v_id, v_now, COALESCE(v_cont, 0), p_result);
    RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.usage_health_compute(bigint, timestamptz, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_usage_health(bigint, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.usage_heartbeat(bigint, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.update_usage_health_prefs(bigint, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.record_usage_reminder(bigint, text, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
    vc.get_usage_health(bigint, timestamptz),
    vc.usage_heartbeat(bigint, timestamptz),
    vc.update_usage_health_prefs(bigint, integer, integer),
    vc.record_usage_reminder(bigint, text, timestamptz)
    TO vc_api;
