-- W07: query-ranked encrypted memories, attributable ST summaries and source
-- time snapshots. No plaintext search index or duplicate source authority.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.conversation ADD COLUMN st_branch_root text;
ALTER TABLE vc.st_message_source ADD COLUMN source_timestamp timestamptz,
    ADD COLUMN source_timezone text, ADD COLUMN source_position integer NOT NULL DEFAULT 0;
ALTER TABLE vc.memory_item ADD COLUMN temporal_cipher text;
ALTER TABLE vc.conversation_summary ALTER COLUMN from_message_id DROP NOT NULL,
    ALTER COLUMN to_message_id DROP NOT NULL, ADD COLUMN st_source_refs text[];

-- Reuse the W06 CAS and invalidation transaction. Time/branch metadata is
-- applied only when that observation actually won; an unavailable read does
-- not choose a new timezone or erase an earlier source timestamp.
ALTER FUNCTION vc.apply_st_source_snapshot(bigint,text,bigint,bigint,text,text,jsonb)
    RENAME TO apply_st_source_snapshot_v142;
CREATE FUNCTION vc.apply_st_source_snapshot(p_owner bigint,p_chat text,p_requested_revision bigint,
    p_revision bigint,p_state text,p_location text,p_messages jsonb,p_branch_root text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE result text;
BEGIN
    result:=vc.apply_st_source_snapshot_v142(p_owner,p_chat,p_requested_revision,p_revision,p_state,p_location,p_messages);
    IF result='PRESENT' THEN
        UPDATE vc.conversation SET st_branch_root=COALESCE(p_branch_root,st_branch_root,p_chat)
          WHERE owner_user_id=p_owner AND st_chat_identity=p_chat;
        IF p_messages IS NOT NULL THEN
            UPDATE vc.st_message_source s SET source_timestamp=(m.value->>'sourceTimestamp')::timestamptz,
                source_timezone=NULLIF(m.value->>'sourceTimezone',''),source_position=m.ordinality::integer
              FROM vc.conversation c,jsonb_array_elements(p_messages) WITH ORDINALITY m
             WHERE c.owner_user_id=p_owner AND c.st_chat_identity=p_chat
               AND s.owner_user_id=p_owner AND s.conversation_id=c.id
               AND s.message_id=(m.value->>'messageId')::uuid AND s.candidate_id=(m.value->>'candidateId')::uuid;
        END IF;
    END IF;
    RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION vc.apply_st_source_snapshot_v142(bigint,text,bigint,bigint,text,text,jsonb),
    vc.apply_st_source_snapshot(bigint,text,bigint,bigint,text,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.apply_st_source_snapshot_v142(bigint,text,bigint,bigint,text,text,jsonb) FROM vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.apply_st_source_snapshot(bigint,text,bigint,bigint,text,text,jsonb,text) TO vc_api,vc_worker;

-- All source dependencies must be in the same allowed scope before text is
-- decrypted/ranked. A branch may use its own copied history, never another
-- member of its branch family. Independent companion chats still share.
CREATE FUNCTION vc.st_memory_scope_allowed(p_owner bigint,p_conversation bigint,p_memory bigint)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT p_owner=vc.current_owner_id() AND NOT EXISTS (
        SELECT 1 FROM vc.conversation target WHERE target.owner_user_id=p_owner AND target.id=p_conversation
            AND target.st_mode='STORY'
    ) AND NOT EXISTS (
        SELECT 1 FROM vc.memory_evidence e
        JOIN vc.conversation origin ON origin.owner_user_id=e.owner_user_id AND origin.st_chat_identity=split_part(e.source_ref,':',2)
        LEFT JOIN vc.conversation target ON target.owner_user_id=p_owner AND target.id=p_conversation
        WHERE e.owner_user_id=p_owner AND e.memory_item_id=p_memory AND e.source_ref LIKE 'st:%'
          AND (origin.st_mode IS DISTINCT FROM 'COMPANION' OR target.st_mode IS DISTINCT FROM 'COMPANION'
            OR (COALESCE(origin.st_branch_root,origin.st_chat_identity)=COALESCE(target.st_branch_root,target.st_chat_identity)
                AND origin.id<>target.id))
    );
$$;

-- Page through the complete owner/instance scope, never a fixed earliest-N
-- window. Ranking happens in Go because summaries remain field encrypted.
CREATE FUNCTION vc.query_memory_candidates(p_owner bigint,p_relationship bigint,p_conversation bigint,p_scope text,p_after bigint)
RETURNS TABLE(out_id bigint,out_scope text,out_summary text,out_conversation bigint,out_created_at timestamptz,
    out_event_at timestamptz,out_event_status text,out_temporal_cipher text,out_sources text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT m.id,m.scope,m.summary,m.conversation_id,m.created_at,m.event_at,m.event_status,m.temporal_cipher,
        ARRAY(SELECT e.source_ref FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=m.id ORDER BY e.id)
      FROM vc.memory_item m
     WHERE m.owner_user_id=p_owner AND m.relationship_id=p_relationship AND m.id>p_after
       AND m.status='ACCEPTED' AND m.deleted_at IS NULL AND m.superseded_at IS NULL AND m.source_invalidated_at IS NULL
       AND (m.event_expires_at IS NULL OR m.event_expires_at>=now())
       AND ((m.scope='SESSION' AND m.conversation_id=p_conversation) OR (m.scope='RELATIONSHIP' AND p_scope<>'SESSION'))
       AND vc.st_memory_scope_allowed(p_owner,p_conversation,m.id)
     ORDER BY m.id LIMIT 256;
END;
$$;
CREATE FUNCTION vc.verified_memory_candidates(p_owner bigint,p_relationship bigint,p_conversation bigint,p_ids bigint[])
RETURNS TABLE(out_id bigint,out_summary text,out_temporal_cipher text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT m.id,m.summary,m.temporal_cipher FROM vc.memory_item m
     WHERE m.owner_user_id=p_owner AND m.relationship_id=p_relationship AND m.id=ANY(p_ids)
       AND m.status='ACCEPTED' AND m.deleted_at IS NULL AND m.superseded_at IS NULL AND m.source_invalidated_at IS NULL
       AND (m.event_expires_at IS NULL OR m.event_expires_at>=now())
       AND vc.st_memory_scope_allowed(p_owner,p_conversation,m.id) AND vc.st_memory_sources_valid(p_owner,m.id);
END;
$$;
CREATE FUNCTION vc.set_memory_temporal(p_owner bigint,p_memory bigint,p_cipher text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_cipher IS NOT NULL AND p_cipher NOT LIKE 'enc2:%' THEN RAISE EXCEPTION 'encrypted temporal data required'; END IF;
    UPDATE vc.memory_item SET temporal_cipher=p_cipher WHERE owner_user_id=p_owner AND id=p_memory;
END;
$$;
CREATE FUNCTION vc.get_memory_temporal(p_owner bigint,p_memory bigint) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT temporal_cipher FROM vc.memory_item WHERE p_owner=vc.current_owner_id() AND owner_user_id=p_owner AND id=p_memory;
$$;
REVOKE ALL ON FUNCTION vc.st_memory_scope_allowed(bigint,bigint,bigint),vc.query_memory_candidates(bigint,bigint,bigint,text,bigint),
    vc.verified_memory_candidates(bigint,bigint,bigint,bigint[]),vc.set_memory_temporal(bigint,bigint,text),vc.get_memory_temporal(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.query_memory_candidates(bigint,bigint,bigint,text,bigint),
    vc.verified_memory_candidates(bigint,bigint,bigint,bigint[]),vc.set_memory_temporal(bigint,bigint,text),vc.get_memory_temporal(bigint,bigint) TO vc_api,vc_worker;

CREATE FUNCTION vc.record_st_summary(p_owner bigint,p_conversation bigint,p_refs text[],p_cipher text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE prior vc.conversation_summary%ROWTYPE; rel bigint; ref text; result bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.memory_write_barrier(p_owner);
    SELECT relationship_id INTO rel FROM vc.conversation WHERE owner_user_id=p_owner AND id=p_conversation AND st_mode='COMPANION' FOR UPDATE;
    IF NOT FOUND OR cardinality(p_refs) NOT BETWEEN 1 AND 12 OR p_cipher NOT LIKE 'enc2:%' THEN RETURN 0; END IF;
    FOREACH ref IN ARRAY p_refs LOOP
        IF NOT vc.guard_st_memory_source(p_owner,rel,ref) OR NOT EXISTS (
            SELECT 1 FROM vc.st_message_source WHERE owner_user_id=p_owner AND conversation_id=p_conversation AND source_ref=ref AND role='user') THEN RETURN 0; END IF;
    END LOOP;
    SELECT * INTO prior FROM vc.conversation_summary WHERE owner_user_id=p_owner AND conversation_id=p_conversation AND st_source_refs IS NOT NULL ORDER BY id DESC LIMIT 1;
    IF FOUND AND prior.valid AND prior.st_source_refs=p_refs THEN RETURN prior.id; END IF;
    UPDATE vc.conversation_summary SET valid=false WHERE owner_user_id=p_owner AND conversation_id=p_conversation AND st_source_refs IS NOT NULL;
    result:=nextval('vc.conversation_summary_id_seq');
    INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,prev_id,st_source_refs)
      VALUES(p_owner,result,p_conversation,p_cipher,'extractive','1','st-source-digest-v1',1,'ECONOMY',prior.id,p_refs);
    RETURN result;
END;
$$;
CREATE FUNCTION vc.read_st_summaries(p_owner bigint,p_conversations bigint[],p_target bigint)
RETURNS TABLE(out_id bigint,out_conversation bigint,out_summary text,out_refs text[],out_created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT s.id,s.conversation_id,s.summary,s.st_source_refs,s.created_at FROM vc.conversation_summary s
      WHERE s.owner_user_id=p_owner AND s.conversation_id=ANY(p_conversations) AND s.valid AND cardinality(s.st_source_refs)>0
        AND EXISTS(SELECT 1 FROM vc.conversation target JOIN vc.relationship r
            ON (r.owner_user_id,r.id)=(target.owner_user_id,target.relationship_id)
          JOIN vc.conversation origin ON origin.owner_user_id=target.owner_user_id AND origin.relationship_id=target.relationship_id
          WHERE target.owner_user_id=p_owner AND target.id=p_target AND origin.id=s.conversation_id
            AND target.st_mode='COMPANION' AND origin.st_mode='COMPANION' AND NOT target.incognito AND NOT origin.incognito
            AND target.st_source_state='PRESENT'
            AND (origin.id=target.id OR (r.memory_share_scope<>'SESSION'
                AND COALESCE(origin.st_branch_root,origin.st_chat_identity)<>COALESCE(target.st_branch_root,target.st_chat_identity))))
        AND NOT EXISTS(SELECT 1 FROM unnest(s.st_source_refs) ref WHERE NOT EXISTS (
          SELECT 1 FROM vc.st_message_source m JOIN vc.conversation c ON (c.owner_user_id,c.id)=(m.owner_user_id,m.conversation_id)
          WHERE m.owner_user_id=p_owner AND m.source_ref=ref AND m.present AND m.settled AND m.eligible AND NOT m.suppressed
            AND c.st_source_state='PRESENT' AND c.st_mode='COMPANION' AND NOT c.incognito))
      ORDER BY s.created_at DESC,s.id DESC;
END;
$$;
CREATE FUNCTION vc.invalidate_st_summary_suppressed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF NEW.suppressed AND NOT OLD.suppressed THEN
        UPDATE vc.conversation_summary SET valid=false,summary=''
          WHERE owner_user_id=NEW.owner_user_id AND NEW.source_ref=ANY(st_source_refs);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER st_summary_suppression AFTER UPDATE OF suppressed ON vc.st_message_source FOR EACH ROW EXECUTE FUNCTION vc.invalidate_st_summary_suppressed();
REVOKE ALL ON FUNCTION vc.record_st_summary(bigint,bigint,text[],text),vc.read_st_summaries(bigint,bigint[],bigint),vc.invalidate_st_summary_suppressed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.record_st_summary(bigint,bigint,text[],text),vc.read_st_summaries(bigint,bigint[],bigint) TO vc_api,vc_worker;

-- Add new provenance to the existing data-rights export; cipher decoding stays
-- in Go. Account deletion already cascades through these existing tables.
ALTER FUNCTION vc.export_v2_owner_metadata(bigint) RENAME TO export_v2_owner_metadata_v144;
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN vc.export_v2_owner_metadata_v144(p_owner) || jsonb_build_object(
      'memoryTimes',COALESCE((SELECT jsonb_agg(jsonb_build_object('memoryId',m.id::text,'content',m.temporal_cipher)) FROM vc.memory_item m WHERE m.owner_user_id=p_owner AND m.deleted_at IS NULL AND m.temporal_cipher IS NOT NULL),'[]'::jsonb),
      'sourceTimes',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceRef',s.source_ref,'sourceTimestamp',s.source_timestamp,'sourceTimezone',s.source_timezone)) FROM vc.st_message_source s WHERE s.owner_user_id=p_owner),'[]'::jsonb),
      'summarySources',COALESCE((SELECT jsonb_agg(jsonb_build_object('summaryId',s.id::text,'sourceRefs',s.st_source_refs)) FROM vc.conversation_summary s WHERE s.owner_user_id=p_owner AND s.st_source_refs IS NOT NULL),'[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint),vc.export_v2_owner_metadata_v144(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata_v144(bigint) FROM vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api,vc_worker;
