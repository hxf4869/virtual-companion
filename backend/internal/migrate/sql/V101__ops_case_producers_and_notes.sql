-- S0-14 completion: intake rows automatically produce redacted cases; R4 is
-- escalated in the same transaction; note writes and body reads are audited;
-- assignment/state transitions fail closed without inventing an SLA.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.ops_case
    ADD CONSTRAINT ops_case_assignee_fk
        FOREIGN KEY (assignee_account_id) REFERENCES vc.identity_account(id)
        ON DELETE SET NULL;

ALTER TABLE vc.ops_case_event
    DROP CONSTRAINT ops_case_event_type;
ALTER TABLE vc.ops_case_event
    ADD CONSTRAINT ops_case_event_type CHECK (event_type IN (
        'OPENED', 'ACK', 'ASSIGN', 'ESCALATE', 'RESOLVE',
        'NOTE', 'PUBLIC_NOTE', 'BODY_ACCESS'));

-- Runs as the migration owner because runtime roles intentionally have no case
-- table DML. The trigger stores source ids and fixed codes only, never body text.
CREATE FUNCTION vc.open_ops_case_from_intake()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_kind text;
    v_severity text;
    v_escalate boolean := false;
    v_case_id bigint;
BEGIN
    IF TG_TABLE_NAME = 'report_request' THEN
        v_kind := 'REPORT';
        v_severity := CASE WHEN NEW.reason IN ('UNSAFE_CONTENT', 'MINOR_SAFEGUARD')
                           THEN 'P1' ELSE 'P2' END;
    ELSIF TG_TABLE_NAME = 'age_appeal' THEN
        v_kind := 'AGE_APPEAL';
        v_severity := 'P1';
    ELSIF TG_TABLE_NAME = 'safety_event' THEN
        IF NEW.risk_level NOT IN ('R3_HIGH', 'R4_IMMINENT') THEN
            RETURN NEW;
        END IF;
        v_kind := 'SAFETY';
        v_severity := CASE WHEN NEW.risk_level = 'R4_IMMINENT' THEN 'P0' ELSE 'P1' END;
        v_escalate := NEW.risk_level = 'R4_IMMINENT';
    ELSE
        RAISE EXCEPTION 'open_ops_case_from_intake: unsupported source table';
    END IF;

    INSERT INTO vc.ops_case(kind, source_owner_user_id, source_id, severity)
    VALUES (v_kind, NEW.owner_user_id, NEW.id, v_severity)
    ON CONFLICT (kind, source_owner_user_id, source_id) DO NOTHING
    RETURNING id INTO v_case_id;
    IF v_case_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO vc.ops_case_event(case_id, event_type, to_status, actor_account_id)
    VALUES (v_case_id, 'OPENED', 'OPEN', NULL);
    IF v_escalate THEN
        UPDATE vc.ops_case SET status = 'ESCALATED', updated_at = now()
         WHERE id = v_case_id;
        INSERT INTO vc.ops_case_event(
            case_id, event_type, from_status, to_status, actor_account_id)
        VALUES (v_case_id, 'ESCALATE', 'OPEN', 'ESCALATED', NULL);
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION vc.open_ops_case_from_intake() FROM PUBLIC;

CREATE TRIGGER report_request_open_ops_case
AFTER INSERT ON vc.report_request
FOR EACH ROW EXECUTE FUNCTION vc.open_ops_case_from_intake();

CREATE TRIGGER age_appeal_open_ops_case
AFTER INSERT ON vc.age_appeal
FOR EACH ROW EXECUTE FUNCTION vc.open_ops_case_from_intake();

CREATE TRIGGER safety_event_open_ops_case
AFTER INSERT ON vc.safety_event
FOR EACH ROW EXECUTE FUNCTION vc.open_ops_case_from_intake();

-- Backfill unresolved intake that predates the triggers. Actor NULL is the fixed
-- system identity; source text is never copied into the case envelope.
DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        INSERT INTO vc.ops_case(kind, source_owner_user_id, source_id, severity)
        SELECT 'REPORT', x.owner_user_id, x.id,
               CASE WHEN x.reason IN ('UNSAFE_CONTENT', 'MINOR_SAFEGUARD')
                    THEN 'P1' ELSE 'P2' END
          FROM vc.report_request x
         WHERE x.status = 'SUBMITTED'
        ON CONFLICT (kind, source_owner_user_id, source_id) DO NOTHING
        RETURNING id
    LOOP
        INSERT INTO vc.ops_case_event(case_id, event_type, to_status)
        VALUES (r.id, 'OPENED', 'OPEN');
    END LOOP;

    FOR r IN
        INSERT INTO vc.ops_case(kind, source_owner_user_id, source_id, severity)
        SELECT 'AGE_APPEAL', x.owner_user_id, x.id, 'P1'
          FROM vc.age_appeal x
         WHERE x.status = 'SUBMITTED'
        ON CONFLICT (kind, source_owner_user_id, source_id) DO NOTHING
        RETURNING id
    LOOP
        INSERT INTO vc.ops_case_event(case_id, event_type, to_status)
        VALUES (r.id, 'OPENED', 'OPEN');
    END LOOP;

    FOR r IN
        INSERT INTO vc.ops_case(kind, source_owner_user_id, source_id, status, severity)
        SELECT 'SAFETY', x.owner_user_id, x.id,
               CASE WHEN x.risk_level = 'R4_IMMINENT' THEN 'ESCALATED' ELSE 'OPEN' END,
               CASE WHEN x.risk_level = 'R4_IMMINENT' THEN 'P0' ELSE 'P1' END
          FROM vc.safety_event x
         WHERE x.risk_level IN ('R3_HIGH', 'R4_IMMINENT')
        ON CONFLICT (kind, source_owner_user_id, source_id) DO NOTHING
        RETURNING id, status
    LOOP
        INSERT INTO vc.ops_case_event(case_id, event_type, to_status)
        VALUES (r.id, 'OPENED', 'OPEN');
        IF r.status = 'ESCALATED' THEN
            INSERT INTO vc.ops_case_event(
                case_id, event_type, from_status, to_status)
            VALUES (r.id, 'ESCALATE', 'OPEN', 'ESCALATED');
        END IF;
    END LOOP;
END;
$$;

CREATE FUNCTION vc.update_ops_case_note(
    p_acting_account_id bigint,
    p_case_id bigint,
    p_visibility text,
    p_note text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_kind text;
    v_owner bigint;
    v_source bigint;
    v_note text := btrim(COALESCE(p_note, ''));
BEGIN
    SELECT a.role INTO v_role FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role IN ('USER', 'OPS_VIEWER') THEN
        RAISE EXCEPTION 'update_ops_case_note: mutation denied';
    END IF;
    IF p_visibility IS NULL OR p_visibility NOT IN ('INTERNAL', 'PUBLIC') THEN
        RAISE EXCEPTION 'update_ops_case_note: unsupported visibility';
    END IF;
    IF (p_visibility = 'INTERNAL' AND char_length(v_note) > 500)
       OR (p_visibility = 'PUBLIC' AND char_length(v_note) > 240) THEN
        RAISE EXCEPTION 'update_ops_case_note: note is too long';
    END IF;

    SELECT c.kind, c.source_owner_user_id, c.source_id
      INTO v_kind, v_owner, v_source
      FROM vc.ops_case c WHERE c.id = p_case_id FOR UPDATE;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'update_ops_case_note: case not found';
    END IF;
    IF NOT vc.ops_case_kind_permitted(v_role, v_kind) THEN
        RAISE EXCEPTION 'update_ops_case_note: kind not permitted for role';
    END IF;

    IF p_visibility = 'INTERNAL' THEN
        UPDATE vc.ops_case SET internal_note = v_note, updated_at = now()
         WHERE id = p_case_id;
        INSERT INTO vc.ops_case_event(case_id, event_type, actor_account_id)
        VALUES (p_case_id, 'NOTE', p_acting_account_id);
    ELSE
        UPDATE vc.ops_case SET public_note = v_note, updated_at = now()
         WHERE id = p_case_id;
        IF v_kind = 'REPORT' THEN
            UPDATE vc.report_request SET resolution_note = v_note
             WHERE owner_user_id = v_owner AND id = v_source;
        ELSIF v_kind = 'AGE_APPEAL' THEN
            UPDATE vc.age_appeal SET resolution_note = v_note
             WHERE owner_user_id = v_owner AND id = v_source;
        END IF;
        INSERT INTO vc.ops_case_event(case_id, event_type, actor_account_id)
        VALUES (p_case_id, 'PUBLIC_NOTE', p_acting_account_id);
    END IF;
    RETURN TRUE;
END;
$$;

-- Replaces V90 with monotonic transitions, assignee authorization, report status
-- synchronization, and a hard requirement that age appeals use the dedicated
-- decision endpoint (which also appends the effective age state).
CREATE OR REPLACE FUNCTION vc.transition_ops_case(
    p_acting_account_id bigint,
    p_case_id bigint,
    p_action text,
    p_assignee_account_id bigint,
    p_disposition_reason text
)
    RETURNS TABLE(out_id bigint, out_status text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_role text;
    v_kind text;
    v_status text;
    v_next text;
    v_reason text := left(btrim(COALESCE(p_disposition_reason, '')), 240);
    v_event text;
    v_assignee_role text;
    v_owner bigint;
    v_source bigint;
    v_public_note text;
BEGIN
    SELECT a.role INTO v_role FROM vc.identity_account a
     WHERE a.id = p_acting_account_id AND a.status = 'ACTIVE';
    IF v_role IS NULL OR v_role IN ('USER', 'OPS_VIEWER') THEN
        RAISE EXCEPTION 'transition_ops_case: mutation denied';
    END IF;
    IF p_action IS NULL OR p_action NOT IN ('ACK', 'ASSIGN', 'ESCALATE', 'RESOLVE') THEN
        RAISE EXCEPTION 'transition_ops_case: unsupported action';
    END IF;
    SELECT c.kind, c.status, c.source_owner_user_id, c.source_id, c.public_note
      INTO v_kind, v_status, v_owner, v_source, v_public_note
      FROM vc.ops_case c WHERE c.id = p_case_id FOR UPDATE;
    IF v_kind IS NULL THEN
        RAISE EXCEPTION 'transition_ops_case: case not found';
    END IF;
    IF NOT vc.ops_case_kind_permitted(v_role, v_kind) THEN
        RAISE EXCEPTION 'transition_ops_case: kind not permitted for role';
    END IF;
    IF v_status = 'RESOLVED' THEN
        RAISE EXCEPTION 'transition_ops_case: case is already resolved';
    END IF;

    IF p_action = 'ACK' THEN
        IF v_status <> 'OPEN' THEN
            RAISE EXCEPTION 'transition_ops_case: ACK would regress case state';
        END IF;
        v_next := 'ACKNOWLEDGED';
        v_event := 'ACK';
    ELSIF p_action = 'ASSIGN' THEN
        SELECT a.role INTO v_assignee_role FROM vc.identity_account a
         WHERE a.id = p_assignee_account_id AND a.status = 'ACTIVE';
        IF v_assignee_role IS NULL OR v_assignee_role IN ('USER', 'OPS_VIEWER')
           OR NOT vc.ops_case_kind_permitted(v_assignee_role, v_kind) THEN
            RAISE EXCEPTION 'transition_ops_case: assignee is not permitted for case kind';
        END IF;
        v_next := CASE WHEN v_status = 'ESCALATED' THEN 'ESCALATED' ELSE 'ASSIGNED' END;
        v_event := 'ASSIGN';
    ELSIF p_action = 'ESCALATE' THEN
        IF v_status = 'ESCALATED' THEN
            RAISE EXCEPTION 'transition_ops_case: case is already escalated';
        END IF;
        v_next := 'ESCALATED';
        v_event := 'ESCALATE';
    ELSE
        IF v_kind = 'AGE_APPEAL' THEN
            RAISE EXCEPTION 'transition_ops_case: age appeal requires a review decision';
        END IF;
        IF v_reason = '' THEN
            RAISE EXCEPTION 'transition_ops_case: disposition_reason is required';
        END IF;
        v_next := 'RESOLVED';
        v_event := 'RESOLVE';
    END IF;

    UPDATE vc.ops_case
       SET status = v_next,
           assignee_account_id = CASE WHEN p_action = 'ASSIGN'
                                      THEN p_assignee_account_id
                                      ELSE assignee_account_id END,
           disposition_reason = CASE WHEN p_action = 'RESOLVE'
                                     THEN v_reason ELSE disposition_reason END,
           updated_at = now()
     WHERE id = p_case_id;
    IF p_action = 'RESOLVE' AND v_kind = 'REPORT' THEN
        UPDATE vc.report_request
           SET status = 'RESOLVED', resolution_note = v_public_note, resolved_at = now()
         WHERE owner_user_id = v_owner AND id = v_source;
    END IF;
    INSERT INTO vc.ops_case_event(
        case_id, event_type, from_status, to_status, actor_account_id)
    VALUES (p_case_id, v_event, v_status, v_next, p_acting_account_id);
    RETURN QUERY SELECT p_case_id, v_next;
END;
$$;

REVOKE ALL ON FUNCTION vc.update_ops_case_note(bigint, bigint, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.update_ops_case_note(bigint, bigint, text, text) TO vc_api;
