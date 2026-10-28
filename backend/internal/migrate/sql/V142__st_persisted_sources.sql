-- W06: ST owns JSONL revisions. Go stores only the last verified source index
-- and encrypted extraction snapshots, scoped by the existing conversation.
SET search_path TO vc, pg_catalog;
ALTER TABLE vc.conversation ADD COLUMN st_applied_revision bigint,
    ADD COLUMN st_source_state text,
    ADD COLUMN st_location text,
    ADD CONSTRAINT conversation_st_source_state CHECK (st_source_state IS NULL OR st_source_state IN ('PRESENT','DELETED','UNAVAILABLE'));
ALTER TABLE vc.memory_item ADD COLUMN source_invalidated_at timestamptz;
CREATE SEQUENCE vc.st_message_source_id_seq AS bigint;
CREATE TABLE vc.st_message_source (
    owner_user_id bigint NOT NULL,
    id bigint NOT NULL DEFAULT nextval('vc.st_message_source_id_seq'),
    conversation_id bigint NOT NULL,
    message_id uuid NOT NULL,
    candidate_id uuid NOT NULL,
    source_revision bigint NOT NULL CHECK (source_revision>0),
    source_generation bigint NOT NULL CHECK (source_generation>0),
    source_ref text NOT NULL,
    role text NOT NULL CHECK (role IN ('user','assistant','system')),
    content_cipher text NOT NULL,
    present boolean NOT NULL,
    settled boolean NOT NULL,
    eligible boolean NOT NULL,
    suppressed boolean NOT NULL DEFAULT false,
    PRIMARY KEY (owner_user_id,id),
    UNIQUE (owner_user_id,conversation_id,message_id,candidate_id),
    UNIQUE (owner_user_id,source_ref),
    FOREIGN KEY (owner_user_id,conversation_id) REFERENCES vc.conversation(owner_user_id,id) ON DELETE CASCADE
);
ALTER TABLE vc.st_message_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.st_message_source FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.st_message_source FOR ALL
    TO vc_api,vc_worker,vc_job_coordinator,vc_dispatcher
    USING (owner_user_id=vc.current_owner_id()) WITH CHECK (owner_user_id=vc.current_owner_id());
REVOKE ALL ON vc.st_message_source, vc.st_message_source_id_seq FROM PUBLIC;
GRANT SELECT ON vc.st_message_source TO vc_api,vc_worker;

CREATE FUNCTION vc.apply_st_source_snapshot(
    p_owner bigint, p_chat text, p_requested_revision bigint,
    p_revision bigint, p_state text, p_location text, p_messages jsonb
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE
    c vc.conversation%ROWTYPE;
    m jsonb;
    prior vc.st_message_source%ROWTYPE;
    generation bigint;
    changed boolean;
    any_changed boolean := false;
    next_ref text;
BEGIN
    IF p_owner IS NULL OR p_owner<=0 OR p_owner IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'apply_st_source_snapshot: trusted owner required';
    END IF;
    IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'apply_st_source_snapshot: deletion in progress'; END IF;
    PERFORM vc.memory_write_barrier(p_owner);
    SELECT * INTO c FROM vc.conversation WHERE owner_user_id=p_owner AND st_chat_identity=p_chat FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'apply_st_source_snapshot: binding not found'; END IF;
    -- A slower observation must not regress a newer committed reconciliation.
    IF c.st_applied_revision IS DISTINCT FROM p_requested_revision THEN RETURN 'RETRY'; END IF;
    IF p_state IS NULL OR p_state NOT IN ('PRESENT','DELETED','UNAVAILABLE') THEN RAISE EXCEPTION 'apply_st_source_snapshot: invalid state'; END IF;
    -- An availability failure cannot erase the durable deletion decision.
    IF c.st_source_state='DELETED' AND p_state='UNAVAILABLE' THEN RETURN 'DELETED'; END IF;
    IF p_state='UNAVAILABLE' OR p_revision IS NULL OR (c.st_applied_revision IS NOT NULL AND p_revision<c.st_applied_revision) THEN
        UPDATE vc.conversation SET st_source_state='UNAVAILABLE' WHERE owner_user_id=p_owner AND id=c.id;
        RETURN 'UNAVAILABLE';
    END IF;
    IF c.st_source_state='DELETED' AND p_state<>'DELETED' THEN
        RAISE EXCEPTION 'apply_st_source_snapshot: deleted chat cannot reappear';
    END IF;
    IF p_state='PRESENT' AND p_messages IS NULL THEN
        IF c.st_applied_revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'apply_st_source_snapshot: snapshot required'; END IF;
        UPDATE vc.conversation SET st_source_state='PRESENT',st_location=p_location WHERE owner_user_id=p_owner AND id=c.id;
        RETURN 'PRESENT';
    END IF;
    IF p_state='DELETED' THEN p_messages := '[]'::jsonb; END IF;
    IF jsonb_typeof(p_messages)<>'array' THEN RAISE EXCEPTION 'apply_st_source_snapshot: invalid messages'; END IF;
    IF EXISTS (
        SELECT 1 FROM vc.st_message_source s JOIN jsonb_array_elements(p_messages) x
          ON s.message_id=(x->>'messageId')::uuid AND s.candidate_id=(x->>'candidateId')::uuid
         WHERE s.owner_user_id=p_owner AND s.conversation_id=c.id AND s.present
           AND s.source_revision>(x->>'revision')::bigint
    ) THEN
        UPDATE vc.conversation SET st_source_state='UNAVAILABLE' WHERE owner_user_id=p_owner AND id=c.id;
        RETURN 'UNAVAILABLE';
    END IF;
    UPDATE vc.st_message_source s SET present=false, settled=false, content_cipher='', source_generation=source_generation+1,
        source_ref=format('st:%s:%s:%s:%s:%s',p_chat,message_id,candidate_id,source_revision,source_generation+1)
     WHERE s.owner_user_id=p_owner AND s.conversation_id=c.id AND s.present
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_messages) x WHERE (x->>'messageId')::uuid=s.message_id AND (x->>'candidateId')::uuid=s.candidate_id);
    any_changed := FOUND;
    FOR m IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
        SELECT * INTO prior FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.conversation_id=c.id
            AND s.message_id=(m->>'messageId')::uuid AND s.candidate_id=(m->>'candidateId')::uuid FOR UPDATE;
        changed := NOT FOUND OR NOT prior.present OR prior.source_revision<>(m->>'revision')::bigint;
        generation := CASE WHEN prior.id IS NULL THEN 1 ELSE prior.source_generation+changed::integer END;
        next_ref := format('st:%s:%s:%s:%s:%s',p_chat,m->>'messageId',m->>'candidateId',m->>'revision',generation);
        INSERT INTO vc.st_message_source(owner_user_id,conversation_id,message_id,candidate_id,source_revision,source_generation,source_ref,role,content_cipher,present,settled,eligible)
        VALUES(p_owner,c.id,(m->>'messageId')::uuid,(m->>'candidateId')::uuid,(m->>'revision')::bigint,generation,next_ref,m->>'role',m->>'cipher',true,(m->>'settled')::boolean,(m->>'eligible')::boolean)
        ON CONFLICT(owner_user_id,conversation_id,message_id,candidate_id) DO UPDATE SET
            source_revision=excluded.source_revision,source_generation=excluded.source_generation,source_ref=excluded.source_ref,
            role=excluded.role,content_cipher=excluded.content_cipher,present=true,settled=excluded.settled,eligible=excluded.eligible;
        -- suppressed is intentionally sticky for this candidate, including restore/reselection.
        any_changed := any_changed OR changed;
    END LOOP;
    UPDATE vc.conversation SET st_applied_revision=p_revision,st_source_state=p_state,st_location=p_location
     WHERE owner_user_id=p_owner AND id=c.id;
    IF any_changed THEN
        UPDATE vc.memory_item mi SET source_invalidated_at=now()
         WHERE mi.owner_user_id=p_owner AND mi.source_invalidated_at IS NULL
           AND EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=mi.id
               AND e.source_ref LIKE 'st:'||p_chat||':%' AND NOT EXISTS (
                   SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.source_ref=e.source_ref AND s.present));
        -- Existing summaries have no ST dependency list. Keep them pending rebuild,
        -- rather than letting an unverifiable cached aggregate survive a source edit.
        UPDATE vc.conversation_summary cs SET valid=false WHERE cs.owner_user_id=p_owner AND cs.valid
          AND cs.conversation_id IN (SELECT id FROM vc.conversation WHERE owner_user_id=p_owner AND relationship_id=c.relationship_id AND st_chat_identity IS NOT NULL);
    END IF;
    RETURN p_state;
END;
$$;

CREATE FUNCTION vc.guard_st_memory_source(p_owner bigint,p_relationship bigint,p_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE s vc.st_message_source%ROWTYPE;
BEGIN
    IF p_owner IS DISTINCT FROM vc.current_owner_id() THEN RAISE EXCEPTION 'guard_st_memory_source: trusted owner required'; END IF;
    SELECT ms.* INTO s FROM vc.st_message_source ms JOIN vc.conversation c
      ON (c.owner_user_id,c.id)=(ms.owner_user_id,ms.conversation_id)
     WHERE ms.owner_user_id=p_owner AND ms.source_ref=p_ref AND c.relationship_id=p_relationship
       AND c.st_source_state='PRESENT' AND NOT c.incognito FOR SHARE OF ms,c;
    RETURN FOUND AND s.present AND s.settled AND s.eligible AND NOT s.suppressed;
END;
$$;
CREATE FUNCTION vc.st_memory_sources_valid(p_owner bigint,p_memory bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT p_owner=vc.current_owner_id() AND NOT EXISTS (
        SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=p_memory AND e.source_ref LIKE 'st:%'
          AND NOT EXISTS (SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
              WHERE s.owner_user_id=p_owner AND s.source_ref=e.source_ref AND s.present AND s.settled AND s.eligible AND NOT s.suppressed AND c.st_source_state='PRESENT' AND NOT c.incognito));
$$;
CREATE FUNCTION vc.guard_st_evidence_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE rel bigint;
BEGIN
    IF NEW.source_ref LIKE 'st:%' THEN
        SELECT relationship_id INTO rel FROM vc.memory_item WHERE owner_user_id=NEW.owner_user_id AND id=NEW.memory_item_id;
        IF NOT vc.guard_st_memory_source(NEW.owner_user_id,rel,NEW.source_ref) THEN RAISE EXCEPTION 'ST source is not current or eligible'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER memory_evidence_st_guard BEFORE INSERT ON vc.memory_evidence FOR EACH ROW EXECUTE FUNCTION vc.guard_st_evidence_insert();
CREATE FUNCTION vc.suppress_deleted_memory_st_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
        UPDATE vc.st_message_source s SET suppressed=true WHERE s.owner_user_id=NEW.owner_user_id
          AND EXISTS (SELECT 1 FROM vc.memory_evidence e JOIN vc.conversation c ON c.owner_user_id=s.owner_user_id AND c.id=s.conversation_id
            WHERE e.owner_user_id=NEW.owner_user_id AND e.memory_item_id=NEW.id AND e.source_ref LIKE 'st:%'
              AND split_part(e.source_ref,':',2)=c.st_chat_identity AND split_part(e.source_ref,':',3)=s.message_id::text
              AND split_part(e.source_ref,':',4)=s.candidate_id::text AND split_part(e.source_ref,':',5)=s.source_revision::text);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER memory_delete_st_suppression AFTER UPDATE OF deleted_at ON vc.memory_item FOR EACH ROW EXECUTE FUNCTION vc.suppress_deleted_memory_st_sources();
REVOKE ALL ON FUNCTION vc.apply_st_source_snapshot(bigint,text,bigint,bigint,text,text,jsonb),vc.guard_st_memory_source(bigint,bigint,text),vc.st_memory_sources_valid(bigint,bigint),vc.guard_st_evidence_insert(),vc.suppress_deleted_memory_st_sources() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.apply_st_source_snapshot(bigint,text,bigint,bigint,text,text,jsonb),vc.guard_st_memory_source(bigint,bigint,text),vc.st_memory_sources_valid(bigint,bigint) TO vc_api,vc_worker;

CREATE OR REPLACE FUNCTION vc.go_select_recall_memories(
    p_owner_user_id    bigint,
    p_relationship_id  bigint,
    p_conversation_id  bigint,
    p_share_scope      text,
    p_max_entries      integer
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_conversation_id bigint)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int;
BEGIN
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'go_select_recall_memories: owner_user_id and relationship_id are required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'go_select_recall_memories: owner_user_id must match server-trusted context';
    END IF;

    -- Due event memories leave the effective set in the same read (V68
    -- pattern): a stale plan must not feed the context as a fresh fact.
    UPDATE vc.memory_item
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACCEPTED'
       AND deleted_at IS NULL
       AND superseded_at IS NULL
       AND event_expires_at IS NOT NULL
       AND event_expires_at < now();

    v_limit := LEAST(GREATEST(p_max_entries, 1), 100);

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.conversation_id
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND m.superseded_at IS NULL
           AND m.source_invalidated_at IS NULL
           AND vc.st_memory_sources_valid(p_owner_user_id,m.id)
           AND (
                (   p_share_scope IS DISTINCT FROM 'SESSION'
                    AND (
                         m.scope = 'RELATIONSHIP'
                      OR (    m.scope = 'SESSION'
                          AND p_conversation_id IS NOT NULL
                          AND m.conversation_id = p_conversation_id)
                    )
                )
                OR
                (   p_share_scope = 'SESSION'
                    AND m.scope = 'SESSION'
                    AND p_conversation_id IS NOT NULL
                    AND m.conversation_id = p_conversation_id
                )
           )
         ORDER BY m.created_at, m.id
         LIMIT v_limit;
END;
$$;


CREATE OR REPLACE FUNCTION vc.recall_memory(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_conversation_id bigint DEFAULT NULL,
    p_max_entries     int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_scope text, out_summary text,
                  out_conversation_id bigint, out_created_at timestamptz,
                  out_event_at timestamptz, out_event_status text)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int;
BEGIN
    IF p_owner_user_id IS NULL THEN
        RAISE EXCEPTION 'p_owner_user_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'p_owner_user_id does not match server-trusted current_owner_id';
    END IF;
    IF p_owner_user_id IS NULL OR p_relationship_id IS NULL THEN
        RAISE EXCEPTION 'recall_memory: owner_user_id and relationship_id are required';
    END IF;

    UPDATE vc.memory_item
       SET status = 'EXPIRED'
     WHERE owner_user_id = p_owner_user_id
       AND status = 'ACCEPTED'
       AND deleted_at IS NULL
       AND superseded_at IS NULL
       AND event_expires_at IS NOT NULL
       AND event_expires_at < now();

    v_limit := LEAST(GREATEST(p_max_entries, 1), 100);

    RETURN QUERY
        SELECT m.id, m.scope, m.summary, m.conversation_id, m.created_at,
               m.event_at, m.event_status
          FROM vc.memory_item m
         WHERE m.owner_user_id = p_owner_user_id
           AND m.relationship_id = p_relationship_id
           AND m.status = 'ACCEPTED'
           AND m.deleted_at IS NULL
           AND m.superseded_at IS NULL
           AND m.source_invalidated_at IS NULL
           AND vc.st_memory_sources_valid(p_owner_user_id,m.id)
           AND (
                    m.scope = 'RELATIONSHIP'
                 OR (    m.scope = 'SESSION'
                     AND p_conversation_id IS NOT NULL
                     AND m.conversation_id = p_conversation_id)
           )
         ORDER BY m.scope, m.created_at, m.id
         LIMIT v_limit;
END;
$$;


CREATE OR REPLACE FUNCTION vc.semantic_recall(
    p_owner_user_id   bigint,
    p_relationship_id bigint,
    p_space_id        text,
    p_query_literal   text,
    p_limit           int DEFAULT 20
)
    RETURNS TABLE(out_memory_id bigint, out_summary text, out_distance double precision)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
    v_query public.vector;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'semantic_recall: owner_user_id is required';
    END IF;
    IF p_relationship_id IS NULL OR p_relationship_id <= 0 THEN
        RAISE EXCEPTION 'semantic_recall: relationship_id is required';
    END IF;
    IF p_space_id IS NULL OR btrim(p_space_id) = '' THEN
        RAISE EXCEPTION 'semantic_recall: space_id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'semantic_recall: owner_user_id must match server-trusted context';
    END IF;

    v_query := p_query_literal::public.vector;

    RETURN QUERY
    SELECT m.id, m.summary, (e.embedding OPERATOR(public.<=>) v_query)::double precision
      FROM vc.memory_embedding e
      JOIN vc.memory_item m
        ON m.owner_user_id = e.owner_user_id
       AND m.id = e.memory_item_id
     WHERE e.owner_user_id = p_owner_user_id
       AND e.embedding_space_id = btrim(p_space_id)
       AND m.relationship_id = p_relationship_id
       AND m.status = 'ACCEPTED'
       AND m.deleted_at IS NULL
       AND m.superseded_at IS NULL
           AND m.source_invalidated_at IS NULL
           AND vc.st_memory_sources_valid(p_owner_user_id,m.id)
     ORDER BY e.embedding OPERATOR(public.<=>) v_query
     LIMIT v_limit;
END;
$$;


-- Candidate enumeration follows the existing SECURITY DEFINER memory API;
-- runtime roles do not gain direct access to the evidence table.
CREATE FUNCTION vc.st_recall_candidates(p_owner bigint,p_relationship bigint,p_conversation bigint,p_scope text)
RETURNS TABLE(out_memory_id bigint,out_chats text[]) LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY
SELECT m.id,COALESCE(array_agg(DISTINCT split_part(e.source_ref,':',2)) FILTER (WHERE e.source_ref LIKE 'st:%'), '{}')
          FROM (SELECT * FROM vc.memory_item WHERE owner_user_id=p_owner AND relationship_id=p_relationship
             AND status='ACCEPTED' AND deleted_at IS NULL AND superseded_at IS NULL AND source_invalidated_at IS NULL
             AND (event_expires_at IS NULL OR event_expires_at>=now())
             AND ((scope='SESSION' AND conversation_id=p_conversation) OR (scope='RELATIONSHIP' AND p_scope<>'SESSION'))
             ORDER BY created_at,id LIMIT 100) m
          LEFT JOIN vc.memory_evidence e ON (e.owner_user_id,e.memory_item_id)=(m.owner_user_id,m.id)
          GROUP BY m.id,m.created_at ORDER BY m.created_at,m.id;
END;
$$;
REVOKE ALL ON FUNCTION vc.st_recall_candidates(bigint,bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.st_recall_candidates(bigint,bigint,bigint,text) TO vc_api,vc_worker;
