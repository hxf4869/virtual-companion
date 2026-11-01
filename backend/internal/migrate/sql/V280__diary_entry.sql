-- UX-33: one first-person diary page per relationship and local day. Written only
-- by the nightly background pass; never read into memory, profile or prompts.
SET search_path=vc,pg_catalog;

CREATE SEQUENCE vc.diary_entry_id_seq AS bigint;
CREATE TABLE vc.diary_entry (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.diary_entry_id_seq'),
    relationship_id bigint NOT NULL,
    day date NOT NULL,
    body text NOT NULL,
    vibe text NOT NULL,
    moments text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (owner_user_id, id),
    FOREIGN KEY (owner_user_id, relationship_id)
        REFERENCES vc.relationship (owner_user_id, id) ON DELETE CASCADE,
    CONSTRAINT diary_entry_day_unique UNIQUE (owner_user_id, relationship_id, day),
    CONSTRAINT diary_entry_body CHECK (char_length(body) BETWEEN 1 AND 300),
    CONSTRAINT diary_entry_vibe CHECK (char_length(vibe) BETWEEN 1 AND 16),
    CONSTRAINT diary_entry_moments CHECK (cardinality(moments) <= 3)
);
ALTER TABLE vc.diary_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.diary_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.diary_entry FOR ALL
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher
    USING (owner_user_id = vc.current_owner_id())
    WITH CHECK (owner_user_id = vc.current_owner_id());
REVOKE ALL ON vc.diary_entry, vc.diary_entry_id_seq FROM PUBLIC;
GRANT SELECT ON vc.diary_entry TO vc_api, vc_worker;

-- A second write for the same day is ignored: the first page of the day stands.
CREATE FUNCTION vc.insert_diary_entry(
    p_owner bigint, p_relationship bigint, p_day date, p_body text, p_vibe text, p_moments text[])
    RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    INSERT INTO vc.diary_entry(owner_user_id, relationship_id, day, body, vibe, moments)
    VALUES (p_owner, p_relationship, p_day, p_body, p_vibe, COALESCE(p_moments, '{}'))
    ON CONFLICT ON CONSTRAINT diary_entry_day_unique DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Relationships with companion chat activity since p_since, for the nightly pass.
-- Incognito chats never count. Day boundaries are decided per relationship in Go.
CREATE FUNCTION vc.list_diary_targets(p_since timestamptz)
    RETURNS TABLE(out_owner bigint, out_relationship bigint)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
    SELECT DISTINCT c.owner_user_id, c.relationship_id
      FROM vc.st_message_source s
      JOIN vc.conversation c ON c.owner_user_id = s.owner_user_id AND c.id = s.conversation_id
     WHERE s.present AND s.role = 'user' AND s.source_timestamp >= p_since
       AND c.st_mode = 'COMPANION' AND NOT c.incognito;
$$;

REVOKE ALL ON FUNCTION
    vc.insert_diary_entry(bigint, bigint, date, text, text, text[]),
    vc.list_diary_targets(timestamptz)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
    vc.insert_diary_entry(bigint, bigint, date, text, text, text[]),
    vc.list_diary_targets(timestamptz)
    TO vc_api, vc_worker;

-- Relationship reset keeps the Companion row, so the rows that hang off it must be
-- cleared explicitly (account and relationship deletion cascade by FK).
CREATE FUNCTION vc.clear_relationship_ux24(p_owner bigint, p_relationship bigint)
    RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    DELETE FROM vc.favorite WHERE owner_user_id = p_owner AND relationship_id = p_relationship;
    DELETE FROM vc.diary_entry WHERE owner_user_id = p_owner AND relationship_id = p_relationship;
END;
$$;
REVOKE ALL ON FUNCTION vc.clear_relationship_ux24(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.clear_relationship_ux24(bigint, bigint) TO vc_api, vc_worker;
