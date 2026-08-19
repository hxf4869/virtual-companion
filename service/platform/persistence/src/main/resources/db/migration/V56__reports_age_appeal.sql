-- REPORT-BE / AGE-APPEAL V56: minimal report & age-appeal intake
-- (FR-DATA-001 举报和申诉状态, §20.15 投诉申诉和误判, FR-AUTH-002 申诉入口).
--
-- Two append-only intake tables a user writes and reads back: report_request
-- (optionally anchored to one of the caller's own messages; the anchor is
-- SET NULL when the message is later deleted so the intake record survives)
-- and age_appeal (submitted only from a state the age-states catalog allows
-- to reach AGE_APPEAL_PENDING; the state flip is appended to the V45
-- age_verification history in the same transaction). R31 delivers
-- submission plus own-status reads only — resolution stays a human admin
-- action (R39 adds the queue page); no ticket numbers, SLA promises or
-- hotline role-play are invented. Foreign or absent rows are never
-- disclosed: a foreign message anchor on create returns 0, foreign reads
-- return no rows.

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS vc.report_request_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.report_request_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.report_request (
    owner_user_id   bigint       NOT NULL,
    id              bigint       NOT NULL,
    message_id      bigint,
    reason          text         NOT NULL,
    note            text         NOT NULL DEFAULT '',
    status          text         NOT NULL DEFAULT 'SUBMITTED',
    resolution_note text         NOT NULL DEFAULT '',
    created_at      timestamptz  NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    FOREIGN KEY (owner_user_id, message_id)
        REFERENCES vc.message(owner_user_id, id) ON DELETE SET NULL,
    CONSTRAINT report_request_reason_check CHECK (reason IN
        ('UNSAFE_CONTENT', 'AI_IDENTITY', 'MINOR_SAFEGUARD',
         'PRIVACY_OR_DATA', 'OTHER')),
    CONSTRAINT report_request_status_check CHECK (status IN
        ('SUBMITTED', 'RESOLVED'))
);

ALTER TABLE vc.report_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.report_request FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.report_request;
CREATE POLICY owner_isolation ON vc.report_request FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.report_request
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- create_report: append one intake row. A non-null message anchor that is
-- absent or foreign returns 0 (indistinguishable; the controller maps it to
-- NOT_FOUND_OR_FORBIDDEN). Returns the new row id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_report(
    p_owner_user_id bigint,
    p_message_id    bigint,
    p_reason        text,
    p_note          text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'create_report: owner_user_id is required';
    END IF;
    IF p_message_id IS NOT NULL AND p_message_id <= 0 THEN
        RAISE EXCEPTION 'create_report: message_id must be positive when present';
    END IF;
    IF p_reason NOT IN ('UNSAFE_CONTENT', 'AI_IDENTITY', 'MINOR_SAFEGUARD',
                        'PRIVACY_OR_DATA', 'OTHER') THEN
        RAISE EXCEPTION 'create_report: unapproved report reason';
    END IF;
    IF p_note IS NULL OR length(btrim(p_note)) > 2000 THEN
        RAISE EXCEPTION 'create_report: note must be 1..2000 trimmed characters';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_report: owner_user_id must match server-trusted context';
    END IF;

    IF p_message_id IS NOT NULL THEN
        PERFORM 1
          FROM vc.message m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.id = p_message_id;
        IF NOT FOUND THEN
            RETURN 0;
        END IF;
    END IF;

    v_id := nextval('vc.report_request_id_seq');
    INSERT INTO vc.report_request(owner_user_id, id, message_id, reason, note)
    VALUES (p_owner_user_id, v_id, p_message_id, p_reason, btrim(p_note));
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_reports: the caller's reports, newest-first keyset (after = the last
-- id seen). Limit clamped to [1, 50].
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_reports(
    p_owner_user_id bigint,
    p_after         bigint,
    p_limit         integer
)
    RETURNS TABLE(out_id bigint, out_message_id bigint, out_reason text,
                  out_note text, out_status text, out_resolution_note text,
                  out_created_at timestamptz, out_resolved_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_reports: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_reports: owner_user_id must match server-trusted context';
    END IF;

    RETURN QUERY
    SELECT r.id, r.message_id, r.reason, r.note, r.status, r.resolution_note,
           r.created_at, r.resolved_at
      FROM vc.report_request r
     WHERE r.owner_user_id = p_owner_user_id
       AND (p_after IS NULL OR r.id < p_after)
     ORDER BY r.id DESC
     LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
END;
$$;

-- ---------------------------------------------------------------------------
-- get_report: one of the caller's reports; absent or foreign yields no rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_report(
    p_owner_user_id bigint,
    p_report_id     bigint
)
    RETURNS TABLE(out_id bigint, out_message_id bigint, out_reason text,
                  out_note text, out_status text, out_resolution_note text,
                  out_created_at timestamptz, out_resolved_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_report: owner_user_id is required';
    END IF;
    IF p_report_id IS NULL OR p_report_id <= 0 THEN
        RAISE EXCEPTION 'get_report: report_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_report: owner_user_id must match server-trusted context';
    END IF;

    RETURN QUERY
    SELECT r.id, r.message_id, r.reason, r.note, r.status, r.resolution_note,
           r.created_at, r.resolved_at
      FROM vc.report_request r
     WHERE r.owner_user_id = p_owner_user_id
       AND r.id = p_report_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Age appeals
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS vc.age_appeal_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.age_appeal_id_seq TO vc_api;

CREATE TABLE IF NOT EXISTS vc.age_appeal (
    owner_user_id   bigint       NOT NULL,
    id              bigint       NOT NULL,
    reason          text         NOT NULL,
    status          text         NOT NULL DEFAULT 'SUBMITTED',
    resolution_note text         NOT NULL DEFAULT '',
    created_at      timestamptz  NOT NULL DEFAULT now(),
    resolved_at     timestamptz,
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT age_appeal_status_check CHECK (status IN
        ('SUBMITTED', 'RESOLVED'))
);

ALTER TABLE vc.age_appeal ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.age_appeal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.age_appeal;
CREATE POLICY owner_isolation ON vc.age_appeal FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

REVOKE SELECT, INSERT, UPDATE, DELETE ON vc.age_appeal
    FROM vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

-- ---------------------------------------------------------------------------
-- submit_age_appeal: append one appeal row and flip the effective age state
-- to AGE_APPEAL_PENDING (appended to the V45 history, provider reference
-- 'age-appeal') in the same transaction. Allowed only from a state the
-- age-states catalog can reach AGE_APPEAL_PENDING from
-- (ADULT_VERIFICATION_REQUIRED / MINOR_SUSPECTED); anything else raises —
-- the runtime pre-validates the transition and maps it to 400 INVALID_REQUEST.
-- Returns the new appeal row id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.submit_age_appeal(
    p_owner_user_id bigint,
    p_reason        text
)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_current text;
    v_id      bigint;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'submit_age_appeal: owner_user_id is required';
    END IF;
    IF p_reason IS NULL OR btrim(p_reason) = ''
       OR length(btrim(p_reason)) > 500 THEN
        RAISE EXCEPTION 'submit_age_appeal: reason must be 1..500 trimmed characters';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'submit_age_appeal: owner_user_id must match server-trusted context';
    END IF;

    SELECT a.age_state INTO v_current
      FROM vc.age_verification a
     WHERE a.owner_user_id = p_owner_user_id
     ORDER BY a.id DESC
     LIMIT 1;
    IF v_current IS NULL THEN
        v_current := 'AGE_UNKNOWN';
    END IF;
    IF v_current NOT IN ('ADULT_VERIFICATION_REQUIRED', 'MINOR_SUSPECTED') THEN
        RAISE EXCEPTION 'submit_age_appeal: the current age state cannot submit an appeal';
    END IF;

    v_id := nextval('vc.age_appeal_id_seq');
    INSERT INTO vc.age_appeal(owner_user_id, id, reason)
    VALUES (p_owner_user_id, v_id, btrim(p_reason));
    INSERT INTO vc.age_verification(owner_user_id, id, age_state, provider_ref)
    VALUES (p_owner_user_id, nextval('vc.age_verification_id_seq'),
            'AGE_APPEAL_PENDING', 'age-appeal');
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_age_appeals: the caller's appeals, newest-first keyset (after = the
-- last id seen). Limit clamped to [1, 50].
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_age_appeals(
    p_owner_user_id bigint,
    p_after         bigint,
    p_limit         integer
)
    RETURNS TABLE(out_id bigint, out_reason text, out_status text,
                  out_resolution_note text, out_created_at timestamptz,
                  out_resolved_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_age_appeals: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_age_appeals: owner_user_id must match server-trusted context';
    END IF;

    RETURN QUERY
    SELECT a.id, a.reason, a.status, a.resolution_note,
           a.created_at, a.resolved_at
      FROM vc.age_appeal a
     WHERE a.owner_user_id = p_owner_user_id
       AND (p_after IS NULL OR a.id < p_after)
     ORDER BY a.id DESC
     LIMIT least(greatest(coalesce(p_limit, 20), 1), 50);
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.create_report(bigint, bigint, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_reports(bigint, bigint, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.get_report(bigint, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.submit_age_appeal(bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_age_appeals(bigint, bigint, integer) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.create_report(bigint, bigint, text, text),
                vc.list_reports(bigint, bigint, integer),
                vc.get_report(bigint, bigint),
                vc.submit_age_appeal(bigint, text),
                vc.list_age_appeals(bigint, bigint, integer)
    TO vc_api;
