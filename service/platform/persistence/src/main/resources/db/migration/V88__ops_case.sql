-- S0-14-A: freeze ops case schema/state. Intake tables stay the user-facing
-- source; this envelope holds severity, nullable SLA hours (NULL = no promise),
-- assignee, disposition and an append-only audit. No assign/ack/resolve API
-- here (S0-14-C). Runtime roles never take table DML.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.ops_case_id_seq AS bigint;
CREATE SEQUENCE IF NOT EXISTS vc.ops_case_event_id_seq AS bigint;

CREATE TABLE vc.ops_case (
    id                   bigint PRIMARY KEY DEFAULT nextval('vc.ops_case_id_seq'),
    kind                 text NOT NULL,
    source_owner_user_id bigint NOT NULL,
    source_id            bigint NOT NULL,
    status               text NOT NULL DEFAULT 'OPEN',
    severity             text NOT NULL,
    sla_hours            integer,
    assignee_account_id  bigint,
    disposition_reason   text NOT NULL DEFAULT '',
    internal_note        text NOT NULL DEFAULT '',
    public_note          text NOT NULL DEFAULT '',
    opened_at            timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (kind, source_owner_user_id, source_id),
    FOREIGN KEY (source_owner_user_id) REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    CONSTRAINT ops_case_kind CHECK (kind IN ('REPORT', 'SAFETY', 'AGE_APPEAL')),
    CONSTRAINT ops_case_status CHECK (status IN (
        'OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'ESCALATED', 'RESOLVED')),
    CONSTRAINT ops_case_severity CHECK (severity IN ('P0', 'P1', 'P2')),
    CONSTRAINT ops_case_sla CHECK (sla_hours IS NULL OR sla_hours > 0),
    CONSTRAINT ops_case_disposition CHECK (char_length(disposition_reason) <= 240),
    CONSTRAINT ops_case_internal_note CHECK (char_length(internal_note) <= 500),
    CONSTRAINT ops_case_public_note CHECK (char_length(public_note) <= 240)
);

CREATE TABLE vc.ops_case_event (
    id                bigint PRIMARY KEY DEFAULT nextval('vc.ops_case_event_id_seq'),
    case_id           bigint NOT NULL REFERENCES vc.ops_case(id) ON DELETE CASCADE,
    event_type        text NOT NULL,
    from_status       text,
    to_status         text,
    actor_account_id  bigint,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ops_case_event_type CHECK (event_type IN (
        'OPENED', 'ACK', 'ASSIGN', 'ESCALATE', 'RESOLVE', 'BODY_ACCESS')),
    CONSTRAINT ops_case_event_to CHECK (
        to_status IS NULL OR to_status IN (
            'OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'ESCALATED', 'RESOLVED'))
);

REVOKE ALL ON vc.ops_case, vc.ops_case_event FROM PUBLIC;
REVOKE ALL ON SEQUENCE vc.ops_case_id_seq, vc.ops_case_event_id_seq FROM PUBLIC;

CREATE FUNCTION vc.open_ops_case(
    p_acting_account_id     bigint,
    p_kind                  text,
    p_source_owner_user_id  bigint,
    p_source_id             bigint,
    p_severity              text
)
    RETURNS TABLE(out_id bigint, out_inserted boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
    v_exists boolean := false;
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'open_ops_case: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'open_ops_case: caller is not an active ADMIN';
    END IF;
    IF p_kind IS NULL OR p_kind NOT IN ('REPORT', 'SAFETY', 'AGE_APPEAL') THEN
        RAISE EXCEPTION 'open_ops_case: unsupported kind';
    END IF;
    IF p_source_owner_user_id IS NULL OR p_source_owner_user_id <= 0
       OR p_source_id IS NULL OR p_source_id <= 0 THEN
        RAISE EXCEPTION 'open_ops_case: source identity is required';
    END IF;
    IF p_severity IS NULL OR p_severity NOT IN ('P0', 'P1', 'P2') THEN
        RAISE EXCEPTION 'open_ops_case: unsupported severity';
    END IF;

    IF p_kind = 'REPORT' THEN
        SELECT true INTO v_exists FROM vc.report_request
         WHERE owner_user_id = p_source_owner_user_id AND id = p_source_id;
    ELSIF p_kind = 'SAFETY' THEN
        SELECT true INTO v_exists FROM vc.safety_event
         WHERE owner_user_id = p_source_owner_user_id AND id = p_source_id;
    ELSE
        SELECT true INTO v_exists FROM vc.age_appeal
         WHERE owner_user_id = p_source_owner_user_id AND id = p_source_id;
    END IF;
    IF v_exists IS NOT TRUE THEN
        RAISE EXCEPTION 'open_ops_case: source intake not found';
    END IF;

    INSERT INTO vc.ops_case(kind, source_owner_user_id, source_id, severity)
    VALUES (p_kind, p_source_owner_user_id, p_source_id, p_severity)
    ON CONFLICT (kind, source_owner_user_id, source_id) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT c.id INTO v_id
          FROM vc.ops_case c
         WHERE c.kind = p_kind
           AND c.source_owner_user_id = p_source_owner_user_id
           AND c.source_id = p_source_id;
        RETURN QUERY SELECT v_id, false;
        RETURN;
    END IF;

    INSERT INTO vc.ops_case_event(case_id, event_type, to_status, actor_account_id)
    VALUES (v_id, 'OPENED', 'OPEN', p_acting_account_id);
    RETURN QUERY SELECT v_id, true;
END;
$$;

CREATE FUNCTION vc.ops_case_snapshot(p_acting_account_id bigint, p_case_id bigint)
    RETURNS TABLE(
        out_id bigint,
        out_kind text,
        out_source_owner_user_id bigint,
        out_source_id bigint,
        out_status text,
        out_severity text,
        out_sla_hours integer,
        out_assignee_account_id bigint,
        out_disposition_reason text,
        out_public_note text,
        out_opened_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_acting_account_id IS NULL OR p_acting_account_id <= 0 THEN
        RAISE EXCEPTION 'ops_case_snapshot: acting account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_acting_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'ops_case_snapshot: caller is not an active ADMIN';
    END IF;
    IF p_case_id IS NULL OR p_case_id <= 0 THEN
        RAISE EXCEPTION 'ops_case_snapshot: case_id is required';
    END IF;
    -- internal_note is stored but never returned here (S0-14-D body/notes leak).
    RETURN QUERY
    SELECT c.id, c.kind, c.source_owner_user_id, c.source_id, c.status, c.severity,
           c.sla_hours, c.assignee_account_id, c.disposition_reason, c.public_note,
           c.opened_at
      FROM vc.ops_case c
     WHERE c.id = p_case_id;
END;
$$;

REVOKE ALL ON FUNCTION vc.open_ops_case(bigint, text, bigint, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.ops_case_snapshot(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.open_ops_case(bigint, text, bigint, bigint, text) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.ops_case_snapshot(bigint, bigint) TO vc_api;
