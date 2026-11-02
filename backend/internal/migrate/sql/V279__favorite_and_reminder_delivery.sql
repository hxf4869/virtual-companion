-- UX-32: favorites (body snapshot plus the ST source position, never fed to memory
-- or prompts) and the worker-side delivery of due vc.reminder rows through the
-- proactive channel. Rows are owner-RLS; runtime roles read, definer functions write.
SET search_path=vc,pg_catalog;

CREATE SEQUENCE vc.favorite_id_seq AS bigint;
CREATE TABLE vc.favorite (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.favorite_id_seq'),
    relationship_id bigint NOT NULL,
    chat_file text NOT NULL,
    mes_id integer NOT NULL,
    role text NOT NULL,
    message_at timestamptz,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT favorite_source_unique UNIQUE (owner_user_id, relationship_id, chat_file, mes_id),
    CONSTRAINT favorite_chat_file CHECK (char_length(chat_file) BETWEEN 1 AND 256),
    CONSTRAINT favorite_mes_id CHECK (mes_id >= 0),
    CONSTRAINT favorite_role CHECK (role IN ('user', 'character')),
    CONSTRAINT favorite_body CHECK (char_length(body) BETWEEN 1 AND 2000)
);
ALTER TABLE vc.favorite ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.favorite FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.favorite FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
REVOKE ALL ON vc.favorite, vc.favorite_id_seq FROM PUBLIC;
GRANT SELECT ON vc.favorite TO vc_api, vc_worker;

-- Idempotent on the source: saving the same message again returns the first row.
CREATE FUNCTION vc.create_favorite(
    p_owner bigint, p_relationship bigint, p_chat text, p_mes integer,
    p_role text, p_message_at timestamptz, p_body text)
    RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    INSERT INTO vc.favorite(owner_user_id, relationship_id, chat_file, mes_id, role, message_at, body)
    VALUES (p_owner, p_relationship, p_chat, p_mes, p_role, p_message_at, p_body)
    ON CONFLICT ON CONSTRAINT favorite_source_unique DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        SELECT f.id INTO v_id FROM vc.favorite f
         WHERE f.owner_user_id = p_owner AND f.relationship_id = p_relationship
           AND f.chat_file = p_chat AND f.mes_id = p_mes;
    END IF;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.delete_favorite(p_owner bigint, p_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    DELETE FROM vc.favorite WHERE owner_user_id = p_owner AND id = p_id;
    RETURN FOUND;
END;
$$;

-- Due ACTIVE reminders of one relationship, oldest first. Delivery turns one into
-- a READY proactive message; consuming it is part of that same transaction.
CREATE FUNCTION vc.due_reminders(p_owner bigint, p_relationship bigint, p_now timestamptz)
    RETURNS TABLE(out_id bigint, out_text text, out_remind_at timestamptz)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
        SELECT r.id, r.text, r.remind_at FROM vc.reminder r
         WHERE r.owner_user_id = p_owner AND r.relationship_id = p_relationship
           AND r.status = 'ACTIVE' AND r.remind_at <= p_now
         ORDER BY r.remind_at, r.id LIMIT 5;
END;
$$;

-- One-shot reminders become DISMISSED; DAILY / WEEKLY roll to the next instant after now.
-- False when the row is no longer ACTIVE, so a concurrent pass cannot deliver it twice.
CREATE FUNCTION vc.consume_reminder(p_owner bigint, p_id bigint, p_now timestamptz)
    RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_rec text;
    v_at timestamptz;
    v_step interval;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT recurrence, remind_at INTO v_rec, v_at FROM vc.reminder
     WHERE owner_user_id = p_owner AND id = p_id AND status = 'ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RETURN false; END IF;
    IF v_rec = 'NONE' THEN
        UPDATE vc.reminder SET status = 'DISMISSED', updated_at = clock_timestamp()
         WHERE owner_user_id = p_owner AND id = p_id;
    ELSE
        v_step := CASE v_rec WHEN 'DAILY' THEN interval '1 day' ELSE interval '7 days' END;
        WHILE v_at <= p_now LOOP v_at := v_at + v_step; END LOOP;
        UPDATE vc.reminder SET remind_at = v_at, updated_at = clock_timestamp()
         WHERE owner_user_id = p_owner AND id = p_id;
    END IF;
    RETURN true;
END;
$$;

-- Targets also include relationships with a due reminder, whatever the proactive mode:
-- the user asked for that reminder explicitly.
CREATE OR REPLACE FUNCTION vc.list_proactive_targets()
    RETURNS TABLE(out_owner bigint, out_relationship bigint)
    LANGUAGE sql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
    SELECT p.owner_user_id, p.relationship_id
      FROM vc.proactive_policy p
     WHERE p.enabled
       AND p.mode IN ('DAILY', 'CLOSE_FRIEND')
    UNION
    SELECT r.owner_user_id, r.relationship_id
      FROM vc.reminder r
     WHERE r.status = 'ACTIVE' AND r.remind_at <= now();
$$;

REVOKE ALL ON FUNCTION
    vc.create_favorite(bigint, bigint, text, integer, text, timestamptz, text),
    vc.delete_favorite(bigint, bigint),
    vc.due_reminders(bigint, bigint, timestamptz),
    vc.consume_reminder(bigint, bigint, timestamptz)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.create_favorite(bigint, bigint, text, integer, text, timestamptz, text),
    vc.delete_favorite(bigint, bigint),
    vc.due_reminders(bigint, bigint, timestamptz),
    vc.consume_reminder(bigint, bigint, timestamptz)
    TO vc_api, vc_worker;
