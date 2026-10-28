-- Forgetting clears the memory body in the row, not only in an HTTP projection.
-- The management API still returns the tombstone (lifecycle FORGOTTEN, summary '')
-- so the memory page can show 「已遗忘」. Evidence excerpts and derived summaries
-- in the same relationship lose that wording; source chat rows stay.
SET search_path=vc,pg_catalog;

CREATE FUNCTION vc.memory_erase_forgotten_wording(p_owner bigint,p_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; wording text; correction text;
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND OR m.deleted_at IS NULL THEN RETURN; END IF;
 wording:=btrim(m.summary);
 correction:=btrim(COALESCE(m.correction_summary,''));
 -- position('' in text) is 1, so an already-erased body must not match every summary.
 UPDATE vc.conversation_summary cs SET valid=false, summary=''
  WHERE cs.owner_user_id=p_owner
    AND cs.conversation_id IN (SELECT id FROM vc.conversation WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id)
    AND (
      EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=p_id AND e.source_ref=ANY(cs.st_source_refs))
      OR CASE WHEN wording<>'' THEN position(wording in cs.summary)>0 ELSE false END
      OR CASE WHEN correction<>'' THEN position(correction in cs.summary)>0 ELSE false END
    );
 UPDATE vc.memory_item SET summary='', correction_summary=NULL
  WHERE owner_user_id=p_owner AND id=p_id AND deleted_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION vc.memory_erase_forgotten_wording(bigint,bigint) FROM PUBLIC;

CREATE OR REPLACE FUNCTION vc.memory_forget_begin(p_owner bigint,p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint; rebuild_job bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF m.cleanup_state<>'NONE' THEN
  PERFORM vc.memory_erase_forgotten_wording(p_owner,p_id);
  RETURN true;
 END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR UPDATE;
 PERFORM vc.delete_memory(p_owner,p_id);
 PERFORM vc.memory_erase_forgotten_wording(p_owner,p_id);
 SELECT op.job_id INTO rebuild_job
  FROM vc.memorycore_operation op
  JOIN vc.st_message_source src ON (src.owner_user_id,src.id)=(op.owner_user_id,op.source_id)
  WHERE op.owner_user_id=p_owner AND op.relationship_id=m.relationship_id AND op.state='PUBLISHED'
    AND src.present AND src.settled AND src.eligible AND NOT src.suppressed
    AND EXISTS (
      SELECT 1 FROM vc.memory_item mi
      JOIN vc.memory_evidence e ON (e.owner_user_id,e.memory_item_id)=(mi.owner_user_id,mi.id)
      WHERE mi.owner_user_id=p_owner AND mi.relationship_id=m.relationship_id AND mi.id<>p_id
        AND mi.deleted_at IS NULL AND mi.superseded_at IS NULL AND mi.source_invalidated_at IS NULL
        AND mi.status='ACCEPTED' AND mi.engine_record_id IS NOT NULL AND e.source_ref=src.source_ref)
  ORDER BY op.job_id DESC LIMIT 1;
 IF rebuild_job IS NOT NULL THEN
  UPDATE vc.memorycore_operation SET profile_operation_id='forget-'||p_id::text||'-profile' WHERE owner_user_id=p_owner AND job_id=rebuild_job;
  UPDATE vc.work_item SET status='PENDING',attempt_count=0,next_attempt_at=NULL,claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL,finished_at=NULL
   WHERE owner_user_id=p_owner AND id=rebuild_job;
 END IF;
 UPDATE vc.memory_item SET cleanup_state='PENDING',cleanup_revision=COALESCE(rev,0) WHERE owner_user_id=p_owner AND id=p_id;
 RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION vc.memory_cleanup_finish(p_owner bigint,p_id bigint,p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE;
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_state NOT IN('DONE','PARTIAL') THEN RAISE EXCEPTION 'invalid cleanup state'; END IF;
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id AND deleted_at IS NOT NULL;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM vc.memory_erase_forgotten_wording(p_owner,p_id);
 IF p_state='DONE' AND (
   EXISTS (
     SELECT 1 FROM vc.conversation_summary cs
     JOIN vc.conversation c ON (c.owner_user_id,c.id)=(cs.owner_user_id,cs.conversation_id)
     WHERE cs.owner_user_id=p_owner AND c.relationship_id=m.relationship_id
       AND cs.valid AND btrim(cs.summary)<>'' AND cs.created_at<=m.deleted_at
       AND EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=p_id AND e.source_ref=ANY(cs.st_source_refs)))
   OR EXISTS (
     SELECT 1 FROM vc.memorycore_operation op
     JOIN vc.work_item w ON (w.owner_user_id,w.id)=(op.owner_user_id,op.job_id)
     WHERE op.owner_user_id=p_owner AND op.relationship_id=m.relationship_id
       AND op.profile_operation_id='forget-'||p_id::text||'-profile'
       AND w.status IS DISTINCT FROM 'DONE')
 ) THEN
  p_state:='PARTIAL';
 END IF;
 UPDATE vc.memory_item SET cleanup_state=p_state,cleanup_detail=CASE WHEN p_state='DONE' THEN '在线记忆副本已清理；原始聊天及离线备份不属于本次遗忘范围。' ELSE '部分在线副本仍在清理，记忆已停止召回。' END
  WHERE owner_user_id=p_owner AND id=p_id AND deleted_at IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION vc.memory_management_row(p_owner bigint,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT jsonb_build_object(
 'memoryId',m.id::text,'relationshipId',m.relationship_id::text,'version',m.management_version,
 'type',CASE WHEN m.event_at IS NULL THEN 'FACT' ELSE 'EVENT' END,'scope',m.scope,
 'summary',CASE WHEN m.deleted_at IS NOT NULL THEN '' ELSE m.summary END,'status',m.status,
 'mode',CASE WHEN c.st_mode='STORY' THEN 'STORY' ELSE 'DAILY' END,
 'lifecycle',CASE WHEN m.deleted_at IS NOT NULL THEN CASE WHEN m.cleanup_state='DONE' THEN 'FORGOTTEN' ELSE 'FORGETTING' END WHEN m.superseded_at IS NOT NULL THEN 'SUPERSEDED' ELSE 'ACTIVE' END,
 'sourceStatus',CASE WHEN m.source_invalidated_at IS NOT NULL OR EXISTS(
   SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=m.id AND e.source_ref LIKE 'st:%'
   AND NOT EXISTS(SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.source_ref=e.source_ref AND s.present AND NOT s.suppressed)) THEN 'INVALID'
   WHEN NOT vc.st_memory_sources_valid(p_owner,m.id) THEN 'PENDING_VERIFICATION' ELSE 'VALID' END,
 'recallEligible',m.engine_record_id IS NOT NULL AND m.status='ACCEPTED' AND m.deleted_at IS NULL AND m.superseded_at IS NULL AND m.source_invalidated_at IS NULL AND vc.st_memory_sources_valid(p_owner,m.id),
 'createdAt',m.created_at,'autoSaved',m.auto_saved,'conversationId',m.conversation_id::text,
 'supersedesMemoryId',m.supersedes_memory_id::text,'supersededByMemoryId',m.superseded_by_memory_id::text,
 'time',COALESCE(m.temporal_cipher::jsonb,jsonb_build_object('recordedAt',m.created_at,'eventDate',null,'eventTime',null,'eventTimezone',null)),
 'cleanup',jsonb_build_object('state',m.cleanup_state,'detail',m.cleanup_detail))
 FROM vc.memory_item m LEFT JOIN vc.conversation c ON(c.owner_user_id,c.id)=(m.owner_user_id,m.conversation_id)
 WHERE p_owner=vc.current_owner_id() AND m.owner_user_id=p_owner AND m.id=p_id;
$$;

CREATE OR REPLACE FUNCTION vc.memory_management_evidence(p_owner bigint,p_id bigint) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT jsonb_build_object('evidenceId',e.id::text,'sourceRef',e.source_ref,'createdAt',e.created_at,
 'chatDisplayName',COALESCE(c.title,'原始聊天'),'messageId',split_part(e.source_ref,':',3),
 'revision',CASE WHEN e.source_ref LIKE 'st:%' THEN split_part(e.source_ref,':',5)::bigint ELSE NULL END,
 'sourceTimestamp',s.source_timestamp,'sourceTimezone',s.source_timezone,
 'status',CASE WHEN e.source_ref NOT LIKE 'st:%' THEN 'VALID' WHEN s.id IS NULL OR NOT s.present OR s.suppressed THEN 'INVALID' WHEN c.st_source_state<>'PRESENT' OR NOT s.settled OR NOT s.eligible THEN 'PENDING_VERIFICATION' ELSE 'VALID' END,
 'excerpt',CASE WHEN m.deleted_at IS NOT NULL THEN '' WHEN s.present AND NOT s.suppressed THEN left(s.content_cipher,500) ELSE '' END)
 FROM vc.memory_evidence e
 LEFT JOIN vc.memory_item m ON (m.owner_user_id,m.id)=(e.owner_user_id,e.memory_item_id)
 LEFT JOIN vc.st_message_source s ON s.owner_user_id=e.owner_user_id AND s.source_ref=e.source_ref
 LEFT JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
 WHERE p_owner=vc.current_owner_id() AND e.owner_user_id=p_owner AND e.memory_item_id=p_id ORDER BY e.id;
$$;

-- Rows forgotten before this migration still hold the body. Clear derived
-- summaries first, while the wording is readable, then blank the tombstone.
UPDATE vc.conversation_summary cs SET valid=false, summary=''
  FROM vc.memory_item m
 WHERE m.deleted_at IS NOT NULL
   AND cs.owner_user_id=m.owner_user_id
   AND cs.conversation_id IN (SELECT id FROM vc.conversation c WHERE c.owner_user_id=m.owner_user_id AND c.relationship_id=m.relationship_id)
   AND (
     EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=m.owner_user_id AND e.memory_item_id=m.id AND e.source_ref=ANY(cs.st_source_refs))
     OR CASE WHEN btrim(m.summary)<>'' THEN position(btrim(m.summary) in cs.summary)>0 ELSE false END
     OR CASE WHEN btrim(COALESCE(m.correction_summary,''))<>'' THEN position(btrim(m.correction_summary) in cs.summary)>0 ELSE false END
   );
UPDATE vc.memory_item SET summary='', correction_summary=NULL
 WHERE deleted_at IS NOT NULL AND (summary<>'' OR correction_summary IS NOT NULL);
