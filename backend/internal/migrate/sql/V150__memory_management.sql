-- W08 management projections and durable correction / cleanup progress.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.memory_item
 ADD COLUMN management_version bigint NOT NULL DEFAULT 1 CHECK(management_version>0),
 ADD COLUMN supersedes_memory_id bigint,
 ADD COLUMN cleanup_state text NOT NULL DEFAULT 'NONE' CHECK(cleanup_state IN('NONE','PENDING','DONE','PARTIAL')),
 ADD COLUMN cleanup_detail text,
 ADD COLUMN cleanup_revision bigint,
 ADD COLUMN correction_operation_id text,
 ADD COLUMN correction_previous_operation_id text,
 ADD COLUMN correction_summary text,
 ADD COLUMN correction_revision bigint;

CREATE FUNCTION vc.memory_management_row(p_owner bigint,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT jsonb_build_object(
 'memoryId',m.id::text,'relationshipId',m.relationship_id::text,'version',m.management_version,
 'type',CASE WHEN m.event_at IS NULL THEN 'FACT' ELSE 'EVENT' END,'scope',m.scope,'summary',m.summary,'status',m.status,
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
CREATE FUNCTION vc.memory_management_list(p_owner bigint,p_rel bigint,p_q text,p_status text,p_from text,p_to text,p_cursor bigint,p_limit integer) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT v.data FROM vc.memory_item m CROSS JOIN LATERAL(SELECT vc.memory_management_row(p_owner,m.id) data) v
 WHERE p_owner=vc.current_owner_id() AND m.owner_user_id=p_owner AND m.relationship_id=p_rel
 AND (p_cursor=0 OR m.id<p_cursor) AND (p_q='' OR strpos(lower(m.summary),lower(p_q))>0)
 AND (p_status='' OR v.data->>'lifecycle'=p_status OR v.data->>'sourceStatus'=p_status)
 AND (p_from='' OR v.data#>>'{time,eventDate}'>=p_from) AND (p_to='' OR v.data#>>'{time,eventDate}'<=p_to)
 ORDER BY m.id DESC LIMIT LEAST(p_limit,101);
$$;
CREATE FUNCTION vc.memory_management_detail(p_owner bigint,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 WITH RECURSIVE chain AS (
 SELECT id,supersedes_memory_id,superseded_by_memory_id FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id AND p_owner=vc.current_owner_id()
 UNION
 SELECT m.id,m.supersedes_memory_id,m.superseded_by_memory_id FROM vc.memory_item m JOIN chain c ON m.id=c.supersedes_memory_id OR m.id=c.superseded_by_memory_id WHERE m.owner_user_id=p_owner
 ) SELECT vc.memory_management_row(p_owner,p_id)||jsonb_build_object('history',COALESCE((SELECT jsonb_agg(vc.memory_management_row(p_owner,id) ORDER BY id DESC) FROM chain),'[]'::jsonb));
$$;
CREATE FUNCTION vc.memory_management_evidence(p_owner bigint,p_id bigint) RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT jsonb_build_object('evidenceId',e.id::text,'sourceRef',e.source_ref,'createdAt',e.created_at,
 'chatDisplayName',COALESCE(c.title,'原始聊天'),'messageId',split_part(e.source_ref,':',3),
 'revision',CASE WHEN e.source_ref LIKE 'st:%' THEN split_part(e.source_ref,':',5)::bigint ELSE NULL END,
 'sourceTimestamp',s.source_timestamp,'sourceTimezone',s.source_timezone,
 'status',CASE WHEN e.source_ref NOT LIKE 'st:%' THEN 'VALID' WHEN s.id IS NULL OR NOT s.present OR s.suppressed THEN 'INVALID' WHEN c.st_source_state<>'PRESENT' OR NOT s.settled OR NOT s.eligible THEN 'PENDING_VERIFICATION' ELSE 'VALID' END,
 'excerpt',CASE WHEN s.present AND NOT s.suppressed THEN left(s.content_cipher,500) ELSE '' END)
 FROM vc.memory_evidence e LEFT JOIN vc.st_message_source s ON s.owner_user_id=e.owner_user_id AND s.source_ref=e.source_ref
 LEFT JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
 WHERE p_owner=vc.current_owner_id() AND e.owner_user_id=p_owner AND e.memory_item_id=p_id ORDER BY e.id;
$$;
CREATE FUNCTION vc.memory_correction_reserve(p_owner bigint,p_id bigint,p_version bigint,p_summary text,p_operation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF m.management_version<>p_version OR m.deleted_at IS NOT NULL OR m.superseded_at IS NOT NULL OR m.engine_record_id IS NULL THEN RETURN jsonb_build_object('conflict',true); END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR UPDATE;
 IF NOT vc.st_memory_sources_valid(p_owner,p_id) OR m.source_invalidated_at IS NOT NULL THEN RETURN jsonb_build_object('conflict',true); END IF;
 IF m.correction_operation_id IS NOT NULL AND m.correction_summary IS DISTINCT FROM p_summary THEN RETURN jsonb_build_object('conflict',true); END IF;
 IF m.correction_operation_id IS NULL THEN
 UPDATE vc.memorycore_scope SET revision=revision+1 WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id RETURNING revision INTO rev;
 UPDATE vc.memorycore_operation SET state='REVOKED' WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id AND state IN('NEW','PROPOSED');
 UPDATE vc.memory_item SET correction_operation_id=p_operation,correction_summary=p_summary,correction_revision=rev WHERE owner_user_id=p_owner AND id=p_id;
 ELSE p_operation:=m.correction_operation_id; rev:=m.correction_revision; END IF;
 UPDATE vc.conversation_summary SET valid=false WHERE owner_user_id=p_owner AND conversation_id IN(SELECT id FROM vc.conversation WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id);
 RETURN jsonb_build_object('operationId',p_operation,'previousOperationId',m.correction_previous_operation_id,'recordId',m.engine_record_id,'engineVersion',m.engine_version,'revision',rev,'relationshipId',m.relationship_id);
END;
$$;
CREATE FUNCTION vc.memory_correction_publish(p_owner bigint,p_id bigint,p_operation text,p_record text,p_engine_version bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; new_id bigint; refs text[]; rev bigint; rebuild_job bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND OR m.correction_operation_id IS DISTINCT FROM p_operation THEN RETURN 0; END IF;
 IF m.superseded_by_memory_id IS NOT NULL THEN RETURN m.superseded_by_memory_id; END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR UPDATE;
 IF m.deleted_at IS NOT NULL OR m.source_invalidated_at IS NOT NULL OR m.correction_revision IS DISTINCT FROM rev OR NOT vc.st_memory_sources_valid(p_owner,p_id) THEN RETURN 0; END IF;
 SELECT array_agg(source_ref ORDER BY id) INTO refs FROM vc.memory_evidence WHERE owner_user_id=p_owner AND memory_item_id=p_id;
 new_id:=vc.create_memory_candidate(p_owner,m.relationship_id,m.scope,m.correction_summary,m.conversation_id,refs);
 PERFORM vc.confirm_memory_candidate(p_owner,new_id,p_id);
 UPDATE vc.memory_item SET management_version=m.management_version+1,supersedes_memory_id=m.id,engine_record_id=p_record,engine_version=p_engine_version,engine_operation_id=p_operation WHERE owner_user_id=p_owner AND id=new_id;
 UPDATE vc.conversation_summary SET valid=false WHERE owner_user_id=p_owner AND conversation_id IN(SELECT id FROM vc.conversation WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id);
 SELECT op.job_id INTO rebuild_job FROM vc.memorycore_operation op JOIN vc.st_message_source src ON(src.owner_user_id,src.id)=(op.owner_user_id,op.source_id)
 WHERE op.owner_user_id=p_owner AND op.relationship_id=m.relationship_id AND op.state='PUBLISHED' AND src.source_ref=ANY(refs)
 ORDER BY op.job_id DESC LIMIT 1;
 IF rebuild_job IS NOT NULL THEN
  UPDATE vc.memorycore_operation SET profile_operation_id=p_operation||'-profile',revision=rev WHERE owner_user_id=p_owner AND job_id=rebuild_job;
  UPDATE vc.work_item SET status='PENDING',attempt_count=0,next_attempt_at=NULL,claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL,finished_at=NULL WHERE owner_user_id=p_owner AND id=rebuild_job;
 END IF;
 RETURN new_id;
END;
$$;
CREATE FUNCTION vc.memory_forget_begin(p_owner bigint,p_id bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 IF m.cleanup_state<>'NONE' THEN RETURN true; END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR UPDATE;
 PERFORM vc.delete_memory(p_owner,p_id);
 UPDATE vc.memory_item SET cleanup_state='PENDING',cleanup_revision=COALESCE(rev,0) WHERE owner_user_id=p_owner AND id=p_id;
 RETURN true;
END;
$$;
CREATE FUNCTION vc.memory_cleanup_pending() RETURNS TABLE(owner_id bigint,memory_id bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT owner_user_id,id FROM vc.memory_item WHERE cleanup_state IN('PENDING','PARTIAL') ORDER BY id LIMIT 100;
$$;
CREATE FUNCTION vc.memory_cleanup_input(p_owner bigint,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT jsonb_build_object('relationshipId',m.relationship_id,'recordId',m.engine_record_id,'revision',m.cleanup_revision,
 'sourceIds',COALESCE((SELECT jsonb_agg(DISTINCT 'source-'||src.id||'-'||split_part(e.source_ref,':',5)||'-'||split_part(e.source_ref,':',6))
 FROM vc.memory_evidence e JOIN vc.st_message_source src ON src.owner_user_id=e.owner_user_id AND src.message_id::text=split_part(e.source_ref,':',3) AND src.candidate_id::text=split_part(e.source_ref,':',4)
 JOIN vc.conversation c ON(c.owner_user_id,c.id)=(src.owner_user_id,src.conversation_id) AND c.st_chat_identity=split_part(e.source_ref,':',2)
 WHERE e.owner_user_id=p_owner AND e.memory_item_id=p_id AND e.source_ref LIKE 'st:%'),'[]'::jsonb))
 FROM vc.memory_item m WHERE p_owner=vc.current_owner_id() AND m.owner_user_id=p_owner AND m.id=p_id AND m.cleanup_state IN('PENDING','PARTIAL');
$$;
CREATE FUNCTION vc.memory_cleanup_finish(p_owner bigint,p_id bigint,p_state text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_state NOT IN('DONE','PARTIAL') THEN RAISE EXCEPTION 'invalid cleanup state'; END IF;
 UPDATE vc.memory_item SET cleanup_state=p_state,cleanup_detail=CASE WHEN p_state='DONE' THEN '在线记忆副本已清理；原始聊天及离线备份不属于本次遗忘范围。' ELSE '部分在线副本仍在清理，记忆已停止召回。' END
 WHERE owner_user_id=p_owner AND id=p_id AND deleted_at IS NOT NULL;
END;
$$;
REVOKE ALL ON FUNCTION vc.memory_management_row(bigint,bigint),vc.memory_management_list(bigint,bigint,text,text,text,text,bigint,integer),vc.memory_management_detail(bigint,bigint),vc.memory_management_evidence(bigint,bigint),vc.memory_correction_reserve(bigint,bigint,bigint,text,text),vc.memory_correction_publish(bigint,bigint,text,text,bigint),vc.memory_forget_begin(bigint,bigint),vc.memory_cleanup_pending(),vc.memory_cleanup_input(bigint,bigint),vc.memory_cleanup_finish(bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_management_row(bigint,bigint),vc.memory_management_list(bigint,bigint,text,text,text,text,bigint,integer),vc.memory_management_detail(bigint,bigint),vc.memory_management_evidence(bigint,bigint),vc.memory_correction_reserve(bigint,bigint,bigint,text,text),vc.memory_correction_publish(bigint,bigint,text,text,bigint),vc.memory_forget_begin(bigint,bigint),vc.memory_cleanup_input(bigint,bigint),vc.memory_cleanup_finish(bigint,bigint,text) TO vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.memory_cleanup_pending() TO vc_api,vc_worker,vc_job_coordinator;

CREATE FUNCTION vc.memory_correction_pending() RETURNS TABLE(owner_id bigint,memory_id bigint,version bigint,summary text)
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT owner_user_id,id,management_version,correction_summary FROM vc.memory_item
 WHERE correction_operation_id IS NOT NULL AND deleted_at IS NULL AND superseded_at IS NULL AND source_invalidated_at IS NULL
 ORDER BY id LIMIT 32;
$$;
REVOKE ALL ON FUNCTION vc.memory_correction_pending() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_correction_pending() TO vc_api,vc_worker;

CREATE FUNCTION vc.memory_correction_verify(p_owner bigint,p_id bigint,p_version bigint,p_operation text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR SHARE;
 IF NOT FOUND OR m.management_version<>p_version OR m.correction_operation_id IS DISTINCT FROM p_operation OR m.deleted_at IS NOT NULL OR m.superseded_at IS NOT NULL OR m.source_invalidated_at IS NOT NULL THEN RETURN false; END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR SHARE;
 RETURN m.correction_revision IS NOT DISTINCT FROM rev AND vc.st_memory_sources_valid(p_owner,p_id);
END;
$$;
REVOKE ALL ON FUNCTION vc.memory_correction_verify(bigint,bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_correction_verify(bigint,bigint,bigint,text) TO vc_api,vc_worker;

CREATE FUNCTION vc.memory_correction_rebase(p_owner bigint,p_id bigint,p_version bigint,p_operation text,p_next text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE m vc.memory_item%ROWTYPE; rev bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND id=p_id FOR UPDATE;
 IF NOT FOUND OR m.management_version<>p_version OR m.correction_operation_id IS DISTINCT FROM p_operation OR m.deleted_at IS NOT NULL OR m.superseded_at IS NOT NULL OR m.source_invalidated_at IS NOT NULL OR NOT vc.st_memory_sources_valid(p_owner,p_id) THEN RETURN -1; END IF;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=m.relationship_id FOR UPDATE;
 UPDATE vc.memory_item SET correction_previous_operation_id=p_operation,correction_operation_id=p_next,correction_revision=rev WHERE owner_user_id=p_owner AND id=p_id;
 RETURN rev;
END;
$$;
REVOKE ALL ON FUNCTION vc.memory_correction_rebase(bigint,bigint,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_correction_rebase(bigint,bigint,bigint,text,text) TO vc_api,vc_worker;
