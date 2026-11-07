-- SX-7: publish Go source deltas and their barriers in the chat transaction.
SET search_path=vc,pg_catalog;

-- Raw chat positions are bigint; the compatibility projection must preserve them.
ALTER TABLE vc.st_message_source ALTER COLUMN source_position TYPE bigint;

CREATE INDEX stored_chat_inbox_message ON vc.stored_chat_inbox(owner_user_id,chat_id,message_id);
CREATE INDEX work_item_st_source_jobs ON vc.work_item(owner_user_id,ref_id,id) WHERE kind='ST_MEMORY_EXTRACT';

CREATE FUNCTION vc.sync_stored_source_jobs(p_owner bigint,p_conversation bigint,p_sources bigint[]) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE jobs bigint[];
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF cardinality(p_sources)=0 THEN RETURN; END IF;
 SELECT coalesce(array_agg(w.id),'{}'::bigint[]) INTO jobs FROM vc.work_item w
  WHERE w.owner_user_id=p_owner AND w.kind='ST_MEMORY_EXTRACT' AND w.ref_id=ANY(p_sources);
 UPDATE vc.work_item w SET status='CANCELLED',claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL,finished_at=clock_timestamp()
  WHERE w.owner_user_id=p_owner AND w.id=ANY(jobs) AND w.status IN ('PENDING','CLAIMED')
   AND NOT EXISTS(SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
    WHERE s.owner_user_id=p_owner AND s.source_ref=w.st_source_ref AND s.present AND s.eligible AND NOT s.suppressed AND NOT c.incognito);
 UPDATE vc.memory_extract_attempt a SET status='ABANDONED',billing_disposition='UNKNOWN',terminal_at=clock_timestamp(),output_payload=NULL
  WHERE a.owner_user_id=p_owner AND a.work_item_id=ANY(jobs) AND a.status='CREATED'
   AND EXISTS(SELECT 1 FROM vc.work_item w WHERE w.owner_user_id=p_owner AND w.id=a.work_item_id AND w.status='CANCELLED');
 UPDATE vc.memory_extract_attempt a SET output_payload=NULL
  WHERE a.owner_user_id=p_owner AND a.work_item_id=ANY(jobs) AND a.output_payload IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.source_ref=a.st_source_ref AND s.present AND NOT s.suppressed);
 IF vc.account_deletion_intent_active_current() OR NOT vc.get_memory_auto_save_pref(p_owner) THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.model_purpose_binding WHERE purpose='MEMORY_EXTRACTION_DEDUP_SUMMARY' AND state='ENABLED' AND provider_id IS NOT NULL) THEN RETURN; END IF;
 INSERT INTO vc.work_item(owner_user_id,id,kind,ref_id,st_source_ref,status)
 SELECT p_owner,nextval('vc.work_item_id_seq'),'ST_MEMORY_EXTRACT',s.id,s.source_ref,'PENDING'
  FROM vc.st_message_source s JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
  WHERE s.owner_user_id=p_owner AND s.conversation_id=p_conversation AND s.id=ANY(p_sources)
   AND s.present AND s.settled AND s.eligible AND NOT s.suppressed AND s.role='user'
   AND c.st_source_state='PRESENT' AND c.st_mode='COMPANION' AND NOT c.incognito
 ON CONFLICT(owner_user_id,st_source_ref) WHERE kind='ST_MEMORY_EXTRACT' DO NOTHING;
END $$;

-- Legacy full snapshots keep their existing job synchronization. Go publication
-- explicitly supplies the changed source IDs, including suppressed candidates.
CREATE OR REPLACE FUNCTION vc.st_source_jobs_after_reconcile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 IF NEW.st_chat_identity IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM vc.chat_authority WHERE owner_user_id=NEW.owner_user_id AND authority='GO') THEN
  PERFORM vc.sync_st_source_jobs(NEW.owner_user_id,NEW.id);
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION vc.st_source_jobs_after_suppression() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 IF NEW.suppressed AND NOT OLD.suppressed THEN
  IF EXISTS(SELECT 1 FROM vc.chat_authority WHERE owner_user_id=NEW.owner_user_id AND authority='GO') THEN
   PERFORM vc.sync_stored_source_jobs(NEW.owner_user_id,NEW.conversation_id,ARRAY[NEW.id]);
  ELSE
   PERFORM vc.sync_st_source_jobs(NEW.owner_user_id,NEW.conversation_id);
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION vc.publish_stored_chat_sources(p_owner bigint,p_chat uuid,p_messages jsonb,p_changed uuid[],p_order boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE chat vc.stored_chat; conv vc.conversation; m jsonb; sources bigint[]; hidden boolean;
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 SELECT * INTO STRICT chat FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_chat;
 IF chat.conversation_id IS NULL THEN RETURN; END IF;
 SELECT * INTO STRICT conv FROM vc.conversation WHERE owner_user_id=p_owner AND id=chat.conversation_id;
 FOR m IN SELECT * FROM jsonb_array_elements(p_messages) LOOP
  -- Counters and selection come from persisted raw identities, not old mirror inference.
  IF NOT EXISTS(SELECT 1 FROM vc.stored_message sm JOIN vc.stored_candidate sc
    ON (sc.owner_user_id,sc.chat_id,sc.message_id,sc.candidate_id)=(sm.owner_user_id,sm.chat_id,sm.message_id,sm.selected_candidate_id)
    WHERE sm.owner_user_id=p_owner AND sm.chat_id=p_chat AND sm.message_id=(m->>'messageId')::uuid
    AND sm.deleted_at IS NULL AND sc.deleted_at IS NULL AND sc.candidate_id=(m->>'candidateId')::uuid
    AND sc.source_revision=(m->>'revision')::bigint AND sc.source_generation=(m->>'generation')::bigint
    AND sc.settled=(m->>'settled')::boolean) THEN RAISE EXCEPTION 'stored source does not match selected candidate'; END IF;
  hidden := conv.incognito OR NOT (m->>'eligible')::boolean;
  INSERT INTO vc.st_message_source(owner_user_id,conversation_id,message_id,candidate_id,source_revision,source_generation,
    source_ref,role,content_cipher,present,settled,eligible,suppressed,source_timestamp,source_timezone,source_position)
   VALUES(p_owner,conv.id,(m->>'messageId')::uuid,(m->>'candidateId')::uuid,(m->>'revision')::bigint,(m->>'generation')::bigint,
    format('st:%s:%s:%s:%s:%s',p_chat,m->>'messageId',m->>'candidateId',m->>'revision',m->>'generation'),m->>'role',
    CASE WHEN hidden THEN '' ELSE m->>'text' END,true,(m->>'settled')::boolean,NOT hidden,
    EXISTS(SELECT 1 FROM vc.proactive_message pm WHERE pm.owner_user_id=p_owner AND pm.relationship_id=conv.relationship_id
      AND pm.status='INBOX' AND pm.body=m->>'text' AND m->>'role'='assistant'),
    (m->>'sourceTimestamp')::timestamptz,NULLIF(m->>'sourceTimezone',''),(m->>'position')::bigint)
   ON CONFLICT(owner_user_id,conversation_id,message_id,candidate_id) DO UPDATE SET
    source_revision=excluded.source_revision,source_generation=excluded.source_generation,source_ref=excluded.source_ref,
    role=excluded.role,content_cipher=excluded.content_cipher,present=true,settled=excluded.settled,eligible=excluded.eligible,
    suppressed=vc.st_message_source.suppressed OR excluded.suppressed,
    source_timestamp=excluded.source_timestamp,source_timezone=excluded.source_timezone,source_position=excluded.source_position;
 END LOOP;
 IF p_order THEN
  UPDATE vc.st_message_source s SET source_position=m.position FROM vc.stored_message m
   WHERE s.owner_user_id=p_owner AND s.conversation_id=conv.id AND m.owner_user_id=p_owner AND m.chat_id=p_chat
    AND m.message_id=s.message_id AND m.deleted_at IS NULL AND s.source_position IS DISTINCT FROM m.position;
 END IF;
 UPDATE vc.conversation SET st_applied_revision=chat.revision,st_source_state=CASE WHEN chat.deleted_at IS NULL THEN 'PRESENT' ELSE 'DELETED' END,
   st_location=NULL,st_branch_root=chat.branch_root::text WHERE owner_user_id=p_owner AND id=conv.id;
 IF chat.deleted_at IS NOT NULL THEN
  SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO sources FROM vc.st_message_source
   WHERE owner_user_id=p_owner AND conversation_id=conv.id;
 ELSE
  SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO sources FROM vc.st_message_source
   WHERE owner_user_id=p_owner AND conversation_id=conv.id AND message_id=ANY(p_changed);
 END IF;
 PERFORM vc.sync_stored_source_jobs(p_owner,conv.id,sources);
 -- Readback/ACK may be delayed, so the durable event mapping also covers an
 -- append committed before ACK and then removed. Never recreate that message.
 IF chat.deleted_at IS NOT NULL THEN
  UPDATE vc.inbox_event SET link_status='removed' WHERE owner_user_id=p_owner AND conversation_id=conv.id;
 ELSIF cardinality(p_changed)>0 THEN
 UPDATE vc.inbox_event i SET link_status=CASE
   WHEN sm.message_id IS NULL OR sm.deleted_at IS NOT NULL THEN 'removed'
   WHEN (NULLIF(i.branch,'') IS NOT NULL AND i.branch<>chat.branch_root::text) OR
     EXISTS(SELECT 1 FROM jsonb_array_elements(p_messages) x WHERE (x->>'messageId')::uuid=mapping.message_id
       AND (x->>'inboxEventId') IS DISTINCT FROM i.event_id) OR
     NOT EXISTS(SELECT 1 FROM vc.stored_candidate sc WHERE sc.owner_user_id=p_owner AND sc.chat_id=p_chat
       AND sc.message_id=sm.message_id AND sc.candidate_id=sm.selected_candidate_id AND sc.deleted_at IS NULL
       AND sc.source_revision>=coalesce(i.st_message_revision,0)) THEN 'invalidated'
   ELSE 'present' END
  FROM vc.stored_chat_inbox mapping LEFT JOIN vc.stored_message sm
    ON (sm.owner_user_id,sm.chat_id,sm.message_id)=(mapping.owner_user_id,mapping.chat_id,mapping.message_id)
  WHERE i.owner_user_id=p_owner AND i.event_id=mapping.event_id AND mapping.owner_user_id=p_owner AND mapping.chat_id=p_chat
   AND mapping.message_id=ANY(p_changed);
 END IF;
END $$;

CREATE FUNCTION vc.copy_stored_chat_sources(p_owner bigint,p_parent uuid,p_child uuid,p_mapping jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE child vc.stored_chat; conv vc.conversation;
BEGIN
 PERFORM vc.require_stored_chat_writer(p_owner);
 SELECT * INTO STRICT child FROM vc.stored_chat WHERE owner_user_id=p_owner AND chat_id=p_child;
 IF child.conversation_id IS NULL THEN RETURN; END IF;
 SELECT * INTO STRICT conv FROM vc.conversation WHERE owner_user_id=p_owner AND id=child.conversation_id;
 -- Copy all previously observed candidates, including deselected suppressed
 -- ones, so selecting them later cannot undo a deliberate forgetting action.
 INSERT INTO vc.st_message_source(owner_user_id,conversation_id,message_id,candidate_id,source_revision,source_generation,source_ref,
   role,content_cipher,present,settled,eligible,suppressed,source_timestamp,source_timezone,source_position)
 SELECT p_owner,conv.id,sm.message_id,sc.candidate_id,sc.source_revision,sc.source_generation,
  format('st:%s:%s:%s:%s:%s',p_child,sm.message_id,sc.candidate_id,sc.source_revision,sc.source_generation),source.role,
  CASE WHEN conv.incognito OR NOT source.eligible OR sm.selected_candidate_id<>sc.candidate_id THEN '' ELSE source.content_cipher END,
  sm.selected_candidate_id=sc.candidate_id,sc.settled AND sm.selected_candidate_id=sc.candidate_id,
  source.eligible AND NOT conv.incognito,source.suppressed,source.source_timestamp,source.source_timezone,sm.position
 FROM jsonb_array_elements(p_mapping) x CROSS JOIN LATERAL jsonb_array_elements(x->'candidates') y
 JOIN vc.stored_chat parent ON parent.owner_user_id=p_owner AND parent.chat_id=p_parent
 JOIN vc.st_message_source source ON source.owner_user_id=p_owner AND source.conversation_id=parent.conversation_id
  AND source.message_id=(x->>'parentMessageId')::uuid AND source.candidate_id=(y->>'parentCandidateId')::uuid
 JOIN vc.stored_message sm ON sm.owner_user_id=p_owner AND sm.chat_id=p_child AND sm.message_id=(x->>'messageId')::uuid
 JOIN vc.stored_candidate sc ON (sc.owner_user_id,sc.chat_id,sc.message_id)=(sm.owner_user_id,sm.chat_id,sm.message_id)
  AND sc.candidate_id=(y->>'candidateId')::uuid;
 PERFORM vc.publish_stored_chat_sources(p_owner,p_child,'[]',ARRAY(SELECT message_id FROM vc.stored_message
  WHERE owner_user_id=p_owner AND chat_id=p_child),false);
END $$;

REVOKE ALL ON FUNCTION vc.sync_stored_source_jobs(bigint,bigint,bigint[]),
 vc.publish_stored_chat_sources(bigint,uuid,jsonb,uuid[],boolean),vc.copy_stored_chat_sources(bigint,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.publish_stored_chat_sources(bigint,uuid,jsonb,uuid[],boolean),
 vc.copy_stored_chat_sources(bigint,uuid,uuid,jsonb) TO vc_api,vc_worker;

CREATE OR REPLACE FUNCTION vc.apply_st_source_snapshot(p_owner bigint,p_chat text,p_requested_revision bigint,
    p_revision bigint,p_state text,p_location text,p_messages jsonb,p_branch_root text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE result text; mode text;
BEGIN
    IF p_owner IS NULL OR p_owner<=0 OR p_owner IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'apply_st_source_snapshot: trusted owner required';
    END IF;
    PERFORM vc.memory_write_barrier(p_owner);
    SELECT authority INTO mode FROM vc.chat_authority WHERE owner_user_id=p_owner FOR SHARE;
    IF coalesce(mode,'ST')<>'ST' THEN RETURN 'RETRY'; END IF;
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

CREATE OR REPLACE FUNCTION vc.end_conversation(
    p_owner_user_id   bigint,
    p_conversation_id bigint
)
    RETURNS TABLE(out_ok boolean, out_incognito_cleared boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_incognito boolean;
    v_generation record;
    raw_chat vc.stored_chat;
BEGIN
    IF p_owner_user_id IS NULL OR p_owner_user_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id is required';
    END IF;
    IF p_conversation_id IS NULL OR p_conversation_id <= 0 THEN
        RAISE EXCEPTION 'end_conversation: conversation id is required';
    END IF;
    IF p_owner_user_id IS DISTINCT FROM vc.current_owner_id() THEN
        RAISE EXCEPTION 'end_conversation: owner_user_id must match server-trusted context';
    END IF;

    PERFORM 1 FROM vc.vc_user WHERE id=p_owner_user_id FOR NO KEY UPDATE;
    PERFORM vc.export_pointer_barrier(p_owner_user_id);
    PERFORM vc.memory_write_barrier(p_owner_user_id);

    SELECT c.incognito INTO v_incognito
      FROM vc.conversation c
     WHERE c.owner_user_id = p_owner_user_id
       AND c.id = p_conversation_id;
    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Closing a work item alone strands its nonterminal generation and
    -- keeps consuming the owner's outstanding-turn allowance forever.
    FOR v_generation IN
        SELECT g.id FROM vc.generation g
         WHERE g.owner_user_id = p_owner_user_id
           AND g.conversation_id = p_conversation_id
           AND NOT vc.go_generation_terminal(g.status)
           AND g.status <> 'COMMITTING'
         ORDER BY g.id
         FOR UPDATE
    LOOP
        PERFORM * FROM vc.go_request_cancel(p_owner_user_id, v_generation.id);
    END LOOP;

    UPDATE vc.work_item w
       SET status = 'CANCELLED'
     WHERE w.owner_user_id = p_owner_user_id
       AND w.status IN ('PENDING', 'CLAIMED')
       AND w.kind = 'MEMORY_EXTRACT'
       AND w.ref_id IN (
            SELECT g.id
              FROM vc.generation g
             WHERE g.owner_user_id = p_owner_user_id
               AND g.conversation_id = p_conversation_id
       );

    IF v_incognito THEN
        SELECT * INTO raw_chat FROM vc.stored_chat WHERE owner_user_id=p_owner_user_id AND conversation_id=p_conversation_id;
        IF FOUND THEN
            UPDATE vc.st_message_source SET present=false,settled=false,eligible=false,content_cipher='',source_generation=source_generation+1,
              source_ref=format('st:%s:%s:%s:%s:%s',raw_chat.chat_id,message_id,candidate_id,source_revision,source_generation+1)
             WHERE owner_user_id=p_owner_user_id AND conversation_id=p_conversation_id AND present;
            UPDATE vc.conversation SET st_source_state='DELETED',st_applied_revision=raw_chat.revision+1,st_location=NULL
             WHERE owner_user_id=p_owner_user_id AND id=p_conversation_id;
            PERFORM vc.sync_stored_source_jobs(p_owner_user_id,p_conversation_id,ARRAY(SELECT id FROM vc.st_message_source
              WHERE owner_user_id=p_owner_user_id AND conversation_id=p_conversation_id));
            UPDATE vc.inbox_event SET link_status='removed' WHERE owner_user_id=p_owner_user_id AND conversation_id=p_conversation_id;
        END IF;
        DELETE FROM vc.stored_chat WHERE owner_user_id=p_owner_user_id AND conversation_id=p_conversation_id;
        UPDATE vc.message
           SET content = ''
         WHERE owner_user_id = p_owner_user_id
           AND conversation_id = p_conversation_id;
    END IF;

    out_ok := true;
    out_incognito_cleared := COALESCE(v_incognito, false);
    RETURN NEXT;
END;
$$;


-- Only evidence writes use this authority fence. Read-side consumers of the
-- legacy boolean guard must not mistake a temporary freeze for permanent loss.
CREATE FUNCTION vc.guard_st_evidence_write(p_owner bigint,p_relationship bigint,p_ref text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE mode text; chat text := split_part(p_ref,':',2);
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 PERFORM vc.memory_write_barrier(p_owner);
 SELECT authority INTO mode FROM vc.chat_authority WHERE owner_user_id=p_owner FOR SHARE;
 mode := coalesce(mode,'ST');
 IF mode='FROZEN' THEN RETURN false; END IF;
 IF mode='GO' AND NOT EXISTS(SELECT 1 FROM vc.conversation c JOIN vc.stored_chat raw
   ON raw.owner_user_id=c.owner_user_id AND raw.conversation_id=c.id AND raw.chat_id::text=c.st_chat_identity
   WHERE c.owner_user_id=p_owner AND c.st_chat_identity=chat AND raw.deleted_at IS NULL
    AND c.st_source_state='PRESENT' AND c.st_applied_revision=raw.revision) THEN RETURN false; END IF;
 RETURN vc.guard_st_memory_source(p_owner,p_relationship,p_ref);
END $$;
REVOKE ALL ON FUNCTION vc.guard_st_evidence_write(bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.guard_st_evidence_write(bigint,bigint,text) TO vc_api,vc_worker;

-- The existing publication algorithm is unchanged; its final source admission
-- uses the same write fence, including proposals with no new evidence rows.
CREATE OR REPLACE FUNCTION vc.go_publish_memorycore(p_owner bigint,p_job bigint,p_token text,p_fence text,p_proposal jsonb,p_refs text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE op vc.memorycore_operation; r jsonb; t jsonb; ref text; mid bigint; first_id bigint; conv bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO op FROM vc.memorycore_operation WHERE owner_user_id=p_owner AND job_id=p_job FOR UPDATE;
 IF NOT FOUND OR op.state='REVOKED' THEN RAISE EXCEPTION 'memorycore operation invalid'; END IF;
 IF op.state='PUBLISHED' THEN RETURN; END IF;
 PERFORM 1 FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=op.relationship_id AND revision=op.revision FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'memorycore revision conflict'; END IF;
 IF NOT EXISTS(SELECT 1 FROM vc.work_item WHERE owner_user_id=p_owner AND id=p_job AND kind='ST_MEMORY_EXTRACT'
  AND status='CLAIMED' AND claim_token=p_token AND claim_fence=p_fence AND lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'memorycore claim lost'; END IF;
 IF NOT vc.get_memory_auto_save_pref(p_owner) OR cardinality(p_refs)=0 THEN RAISE EXCEPTION 'memorycore source unavailable'; END IF;
 FOREACH ref IN ARRAY p_refs LOOP
  IF NOT vc.guard_st_evidence_write(p_owner,op.relationship_id,ref) THEN RAISE EXCEPTION 'memorycore source invalid'; END IF;
 END LOOP;
 SELECT conversation_id INTO conv FROM vc.st_message_source WHERE owner_user_id=p_owner AND id=op.source_id;
 PERFORM 1 FROM vc.conversation WHERE owner_user_id=p_owner AND id=conv AND relationship_id=op.relationship_id AND st_mode='COMPANION' AND st_source_state='PRESENT' AND NOT incognito FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'memorycore target binding changed'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_refs) AS dep(source_ref) WHERE NOT EXISTS(
  SELECT 1 FROM vc.st_message_source src JOIN vc.conversation origin ON(origin.owner_user_id,origin.id)=(src.owner_user_id,src.conversation_id)
  JOIN vc.conversation target ON target.owner_user_id=p_owner AND target.id=conv
  JOIN vc.relationship rel ON(rel.owner_user_id,rel.id)=(target.owner_user_id,target.relationship_id)
  WHERE src.owner_user_id=p_owner AND src.source_ref=dep.source_ref AND origin.relationship_id=target.relationship_id
   AND origin.st_mode='COMPANION' AND origin.st_source_state='PRESENT' AND NOT origin.incognito
   AND (origin.id=target.id OR (rel.memory_share_scope<>'SESSION' AND COALESCE(origin.st_branch_root,origin.st_chat_identity)<>COALESCE(target.st_branch_root,target.st_chat_identity)))))
 THEN RAISE EXCEPTION 'memorycore dependency scope changed'; END IF;

 FOR t IN SELECT value FROM jsonb_array_elements(COALESCE(p_proposal->'targets','[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM vc.memory_item WHERE owner_user_id=p_owner AND relationship_id=op.relationship_id
    AND engine_record_id=t->>'id' AND engine_version=(t->>'version')::bigint AND vc.st_memory_scope_allowed(p_owner,conv,id) AND vc.st_memory_sources_valid(p_owner,id) AND deleted_at IS NULL AND superseded_at IS NULL AND source_invalidated_at IS NULL)
  THEN RAISE EXCEPTION 'memorycore target version conflict'; END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p_proposal->'records') LOOP
  mid:=nextval('vc.memory_id_seq');
  INSERT INTO vc.memory_item(owner_user_id,id,relationship_id,scope,summary,status,conversation_id,auto_saved,engine_record_id,engine_version,engine_operation_id)
  VALUES(p_owner,mid,op.relationship_id,'RELATIONSHIP',r->>'content','ACCEPTED',conv,true,r->>'id',(r->>'version')::bigint,op.operation_id);
  UPDATE vc.memory_item n SET supersedes_memory_id=old.id, management_version=old.management_version+1
   FROM (SELECT id,management_version FROM vc.memory_item WHERE owner_user_id=p_owner AND engine_record_id IN(SELECT value->>'id' FROM jsonb_array_elements(COALESCE(p_proposal->'targets','[]'))) ORDER BY id LIMIT 1) old
   WHERE n.owner_user_id=p_owner AND n.id=mid;
  first_id:=COALESCE(first_id,mid);
  FOREACH ref IN ARRAY p_refs LOOP
   INSERT INTO vc.memory_evidence(owner_user_id,id,memory_item_id,source_ref) VALUES(p_owner,nextval('vc.memory_id_seq'),mid,ref);
  END LOOP;
 END LOOP;
 UPDATE vc.memory_item SET superseded_at=clock_timestamp(),superseded_by_memory_id=first_id
 WHERE owner_user_id=p_owner AND engine_record_id IN(SELECT value->>'id' FROM jsonb_array_elements(COALESCE(p_proposal->'targets','[]')));
 IF jsonb_array_length(COALESCE(p_proposal->'targets','[]'))>0 THEN
 UPDATE vc.conversation_summary cs SET valid=false WHERE cs.owner_user_id=p_owner AND EXISTS(
 SELECT 1 FROM vc.memory_evidence e JOIN vc.memory_item m ON(m.owner_user_id,m.id)=(e.owner_user_id,e.memory_item_id)
 WHERE m.owner_user_id=p_owner AND m.engine_record_id IN(SELECT value->>'id' FROM jsonb_array_elements(p_proposal->'targets')) AND e.source_ref=ANY(cs.st_source_refs));
 END IF;
 UPDATE vc.memorycore_operation SET state='PUBLISHED',proposal=p_proposal WHERE owner_user_id=p_owner AND job_id=p_job;
END; $$;

CREATE OR REPLACE FUNCTION vc.guard_st_evidence_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE rel bigint;
BEGIN
    IF NEW.source_ref LIKE 'st:%' THEN
        SELECT relationship_id INTO rel FROM vc.memory_item WHERE owner_user_id=NEW.owner_user_id AND id=NEW.memory_item_id;
        IF NOT vc.guard_st_evidence_write(NEW.owner_user_id,rel,NEW.source_ref) THEN RAISE EXCEPTION 'ST source is not current or eligible'; END IF;
    END IF;
    RETURN NEW;
END;
$$;
