-- Forgetting one memory drops derived summaries that still depend on it and
-- rebuilds the profile from remaining allowed records before cleanup can finish.
SET search_path=vc,pg_catalog;

CREATE OR REPLACE FUNCTION vc.memory_forget_begin(p_owner bigint,p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint; rebuild_job bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF m.cleanup_state<>'NONE' THEN RETURN true; END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR UPDATE;
 PERFORM vc.delete_memory(p_owner,p_id);
 UPDATE vc.conversation_summary cs SET valid=false, summary=''
  WHERE cs.owner_user_id=p_owner
    AND cs.conversation_id IN (SELECT id FROM vc.conversation WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id)
    AND EXISTS (SELECT 1 FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=p_id AND e.source_ref=ANY(cs.st_source_refs));
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

-- A cleared tombstone must not be injected even if a later reader skips valid.
CREATE OR REPLACE FUNCTION vc.read_st_summaries(p_owner bigint,p_conversations bigint[],p_target bigint)
RETURNS TABLE(out_id bigint,out_conversation bigint,out_summary text,out_refs text[],out_created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT s.id,s.conversation_id,s.summary,s.st_source_refs,s.created_at FROM vc.conversation_summary s
      WHERE s.owner_user_id=p_owner AND s.conversation_id=ANY(p_conversations) AND s.valid AND btrim(s.summary)<>'' AND cardinality(s.st_source_refs)>0
        AND EXISTS(SELECT 1 FROM vc.conversation target JOIN vc.relationship r
            ON (r.owner_user_id,r.id)=(target.owner_user_id,target.relationship_id)
          JOIN vc.conversation origin ON origin.owner_user_id=target.owner_user_id AND origin.relationship_id=target.relationship_id
          WHERE target.owner_user_id=p_owner AND target.id=p_target AND origin.id=s.conversation_id
            AND target.st_mode='COMPANION' AND origin.st_mode='COMPANION' AND NOT target.incognito AND NOT origin.incognito
            AND target.st_source_state='PRESENT'
            AND (origin.id=target.id OR (r.memory_share_scope<>'SESSION'
                AND COALESCE(origin.st_branch_root,origin.st_chat_identity)<>COALESCE(target.st_branch_root,target.st_chat_identity))))
        AND NOT EXISTS(SELECT 1 FROM unnest(s.st_source_refs) ref WHERE NOT EXISTS (
          SELECT 1 FROM vc.st_message_source m
          JOIN vc.conversation c ON (c.owner_user_id,c.id)=(m.owner_user_id,m.conversation_id)
          JOIN vc.conversation target ON target.owner_user_id=p_owner AND target.id=p_target AND target.relationship_id=c.relationship_id
          JOIN vc.relationship r ON (r.owner_user_id,r.id)=(target.owner_user_id,target.relationship_id)
          WHERE m.owner_user_id=p_owner AND m.source_ref=ref AND m.present AND m.settled AND m.eligible AND NOT m.suppressed
            AND c.st_source_state='PRESENT' AND c.st_mode='COMPANION' AND NOT c.incognito
            AND (c.id=target.id OR (r.memory_share_scope<>'SESSION'
                AND COALESCE(c.st_branch_root,c.st_chat_identity)<>COALESCE(target.st_branch_root,target.st_chat_identity)))))
      ORDER BY s.created_at DESC,s.id DESC;
END;
$$;
