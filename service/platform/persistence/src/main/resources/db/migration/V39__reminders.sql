-- REMINDER V39: structured user-created reminders (FR-NOTIFY-001).
--
-- Reminders are STRUCTURED records — the model can never "just remember to
-- remind later" in a prompt. A reminder belongs to the owner's relationship
-- (cascade with it), carries a UTC remind_at instant plus a recurrence class
-- (NONE / DAILY / WEEKLY — the Alpha UI only creates NONE/WEEKLY today) and an
-- ACTIVE/DISMISSED lifecycle. No push transport exists in Technical Alpha
-- (product-scope: 不提供主动消息); this module is the canonical record store
-- the Beta push path will consume.
--
-- Product rules enforced here and in the API layer: only the USER creates
-- reminders (no model-initiated contacts), no frequency is derived from
-- intimacy, and the UI keeps the tone neutral. All access flows through the
-- V17 trusted-owner SECURITY DEFINER functions below; runtime roles receive no
-- table grants (V16 posture) and the table is FORCE RLS with owner_isolation.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.reminder_id_seq AS bigint;
GRANT USAGE, SELECT ON SEQUENCE vc.reminder_id_seq
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE TABLE IF NOT EXISTS vc.reminder (
    owner_user_id   bigint      NOT NULL,
    id              bigint      NOT NULL,
    relationship_id bigint      NOT NULL,
    text            text        NOT NULL,
    remind_at       timestamptz NOT NULL,
    recurrence      text        NOT NULL DEFAULT 'NONE',
    status          text        NOT NULL DEFAULT 'ACTIVE',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship(owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT reminder_text_len CHECK (length(text) BETWEEN 1 AND 500),
    CONSTRAINT reminder_recurrence_check
        CHECK (recurrence IN ('NONE', 'DAILY', 'WEEKLY')),
    CONSTRAINT reminder_status_check
        CHECK (status IN ('ACTIVE', 'DISMISSED'))
);

ALTER TABLE vc.reminder ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.reminder FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_isolation ON vc.reminder;
CREATE POLICY owner_isolation ON vc.reminder FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());

-- ---------------------------------------------------------------------------
-- create_reminder: user-created structured reminder under a relationship.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.create_reminder(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_text            text,
    p_remind_at       timestamptz,
    p_recurrence      text DEFAULT 'NONE'
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
        RAISE EXCEPTION 'create_reminder: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'create_reminder: relationship_id is required';
    END IF;
    IF p_text IS NULL OR btrim(p_text) = '' OR length(p_text) > 500 THEN
        RAISE EXCEPTION 'create_reminder: text must be 1..500 characters';
    END IF;
    IF p_remind_at IS NULL THEN
        RAISE EXCEPTION 'create_reminder: remind_at is required';
    END IF;
    IF p_recurrence NOT IN ('NONE', 'DAILY', 'WEEKLY') THEN
        RAISE EXCEPTION 'create_reminder: recurrence must be NONE, DAILY or WEEKLY';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'create_reminder: owner_user_id must match server-trusted context';
    END IF;

    v_id := nextval('vc.reminder_id_seq');
    INSERT INTO vc.reminder(owner_user_id, id, relationship_id, text,
                            remind_at, recurrence)
    VALUES (p_owner_user_id, v_id, p_relationship_id, btrim(p_text),
            p_remind_at, p_recurrence);
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- list_reminders: keyset page of the relationship's reminders, soonest first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.list_reminders(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_after_id        bigint DEFAULT 0,
    p_limit           integer DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_text text,
                  out_remind_at timestamptz, out_recurrence text, out_status text,
                  out_created_at timestamptz, out_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'list_reminders: owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'list_reminders: owner_user_id must match server-trusted context';
    END IF;
    RETURN QUERY
        SELECT r.id, r.relationship_id, r.text, r.remind_at, r.recurrence,
               r.status, r.created_at, r.updated_at
          FROM vc.reminder r
         WHERE r.owner_user_id = p_owner_user_id
           AND (p_relationship_id IS NULL OR r.relationship_id = p_relationship_id)
           AND r.id > p_after_id
         ORDER BY r.remind_at, r.id
         LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
END;
$$;

-- ---------------------------------------------------------------------------
-- update_reminder: text / remind_at / recurrence / status for an owned row.
-- Blank text or a NULL remind_at clears nothing — every field must be valid
-- (no partial silent edits). Returns TRUE only when an owned row changed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.update_reminder(
    p_owner_user_id bigint,
    p_reminder_id   bigint,
    p_text          text,
    p_remind_at     timestamptz,
    p_recurrence    text,
    p_status        text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'update_reminder: owner_user_id is required';
    END IF;
    IF p_reminder_id IS NULL OR p_reminder_id <= 0 THEN
        RAISE EXCEPTION 'update_reminder: reminder id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'update_reminder: owner_user_id must match server-trusted context';
    END IF;
    IF p_text IS NULL OR btrim(p_text) = '' OR length(p_text) > 500 THEN
        RAISE EXCEPTION 'update_reminder: text must be 1..500 characters';
    END IF;
    IF p_remind_at IS NULL THEN
        RAISE EXCEPTION 'update_reminder: remind_at is required';
    END IF;
    IF p_recurrence NOT IN ('NONE', 'DAILY', 'WEEKLY') THEN
        RAISE EXCEPTION 'update_reminder: recurrence must be NONE, DAILY or WEEKLY';
    END IF;
    IF p_status NOT IN ('ACTIVE', 'DISMISSED') THEN
        RAISE EXCEPTION 'update_reminder: status must be ACTIVE or DISMISSED';
    END IF;

    UPDATE vc.reminder
       SET text = btrim(p_text),
           remind_at = p_remind_at,
           recurrence = p_recurrence,
           status = p_status,
           updated_at = now()
     WHERE owner_user_id = p_owner_user_id
       AND id = p_reminder_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- ---------------------------------------------------------------------------
-- delete_reminder: remove an owned reminder. FALSE for foreign/absent ids.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.delete_reminder(
    p_owner_user_id bigint,
    p_reminder_id   bigint
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rows int;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'delete_reminder: owner_user_id is required';
    END IF;
    IF p_reminder_id IS NULL OR p_reminder_id <= 0 THEN
        RAISE EXCEPTION 'delete_reminder: reminder id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'delete_reminder: owner_user_id must match server-trusted context';
    END IF;

    DELETE FROM vc.reminder
     WHERE owner_user_id = p_owner_user_id
       AND id = p_reminder_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows > 0;
END;
$$;

-- Closed by default: only the API ingestion role may use these functions.
REVOKE EXECUTE ON FUNCTION vc.create_reminder(bigint, bigint, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.list_reminders(bigint, bigint, bigint, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.update_reminder(bigint, bigint, text, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.delete_reminder(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE
    ON FUNCTION vc.create_reminder(bigint, bigint, text, timestamptz, text),
                vc.list_reminders(bigint, bigint, bigint, integer),
                vc.update_reminder(bigint, bigint, text, timestamptz, text, text),
                vc.delete_reminder(bigint, bigint)
    TO vc_api;

-- ---------------------------------------------------------------------------
-- get_reminder: read one owned reminder (foreign/absent -> no rows).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.get_reminder(
    p_owner_user_id bigint,
    p_reminder_id   bigint
)
    RETURNS TABLE(out_id bigint, out_relationship_id bigint, out_text text,
                  out_remind_at timestamptz, out_recurrence text, out_status text,
                  out_created_at timestamptz, out_updated_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'get_reminder: owner_user_id is required';
    END IF;
    IF p_reminder_id IS NULL OR p_reminder_id <= 0 THEN
        RAISE EXCEPTION 'get_reminder: reminder id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'get_reminder: owner_user_id must match server-trusted context';
    END IF;
    RETURN QUERY
        SELECT r.id, r.relationship_id, r.text, r.remind_at, r.recurrence,
               r.status, r.created_at, r.updated_at
          FROM vc.reminder r
         WHERE r.owner_user_id = p_owner_user_id
           AND r.id = p_reminder_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.get_reminder(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.get_reminder(bigint, bigint) TO vc_api;
