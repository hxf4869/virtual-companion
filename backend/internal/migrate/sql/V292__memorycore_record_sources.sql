-- CM-4: per-fact evidence and partial recovery. Add overloads only.
-- V290 six-argument publication, V149 two-argument full cleanup, V291 profile,
-- source protocols, triggers and their lock order remain unchanged.
SET search_path=vc,pg_catalog;

CREATE FUNCTION vc.go_publish_memorycore(p_owner bigint,p_job bigint,p_token text,p_fence text,p_proposal jsonb,p_refs text[],p_record_refs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE op vc.memorycore_operation; r jsonb; t jsonb; ref text; mid bigint; conv bigint;
 record_refs text[]; record_keys text[]; supplied_keys text[]; union_refs text[];
 record_ids text[]; mapped_ids text[]; target_ids text[]; record_targets text[];
 records jsonb := '[]'::jsonb; metadata jsonb; all_keys text[];
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
 -- New overload only: validate the per-record mapping before any publication.
 -- Legacy six-argument calls continue to run the unchanged V290 implementation.
 IF jsonb_typeof(p_proposal) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_proposal->'records') IS DISTINCT FROM 'array'
  OR jsonb_typeof(p_record_refs) IS DISTINCT FROM 'object'
  OR p_refs IS NULL OR cardinality(p_refs)=0
  OR EXISTS(SELECT 1 FROM unnest(p_refs) x WHERE x IS NULL OR x='')
  OR cardinality(p_refs)<>(SELECT count(DISTINCT x) FROM unnest(p_refs) x)
 THEN RAISE EXCEPTION 'memorycore record sources invalid'; END IF;
 SELECT COALESCE(array_agg(x->>'id' ORDER BY x->>'id'),'{}') INTO record_ids
 FROM jsonb_array_elements(p_proposal->'records') x;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_proposal->'records') x
  WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR x->>'id'='')
  OR cardinality(record_ids)<>(SELECT count(DISTINCT x) FROM unnest(record_ids) x)
 THEN RAISE EXCEPTION 'memorycore record identities invalid'; END IF;
 SELECT COALESCE(array_agg(k ORDER BY k),'{}') INTO mapped_ids FROM jsonb_object_keys(p_record_refs) k;
 IF mapped_ids IS DISTINCT FROM record_ids THEN RAISE EXCEPTION 'memorycore record source keys mismatch'; END IF;
 FOR r IN SELECT value FROM jsonb_each(p_record_refs) LOOP
  IF jsonb_typeof(r) IS DISTINCT FROM 'array' OR jsonb_array_length(r)=0 THEN
   RAISE EXCEPTION 'memorycore record sources invalid';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(r) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR x#>>'{}'='')
   OR jsonb_array_length(r)<>(SELECT count(DISTINCT x) FROM jsonb_array_elements(r) x)
  THEN RAISE EXCEPTION 'memorycore record sources invalid'; END IF;
 END LOOP;
 SELECT COALESCE(array_agg(DISTINCT v#>>'{}' ORDER BY v#>>'{}'),'{}') INTO union_refs
 FROM jsonb_each(p_record_refs) e CROSS JOIN LATERAL jsonb_array_elements(e.value) v;
 IF cardinality(record_ids)>0 AND union_refs IS DISTINCT FROM ARRAY(SELECT x FROM unnest(p_refs) x ORDER BY x) THEN
  RAISE EXCEPTION 'memorycore record source union mismatch';
 END IF;
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
 -- The Go caller checks extraction-window membership. SQL independently ties
 -- each fact's explicit source keys to its verified refs and at least one user.
 SELECT COALESCE(array_agg('source-'||id||'-'||source_revision||'-'||source_generation
  ORDER BY 'source-'||id||'-'||source_revision||'-'||source_generation),'{}') INTO all_keys
 FROM vc.st_message_source WHERE owner_user_id=p_owner AND source_ref=ANY(p_refs);
 IF cardinality(record_ids)=0 AND NOT EXISTS(SELECT 1 FROM vc.st_message_source
  WHERE owner_user_id=p_owner AND id=op.source_id AND role='user' AND source_ref=ANY(p_refs)) THEN
  RAISE EXCEPTION 'memorycore empty proposal requires current user source';
 END IF;
 SELECT COALESCE(array_agg(x->>'id'),'{}') INTO target_ids FROM jsonb_array_elements(COALESCE(p_proposal->'targets','[]')) x;
 FOR r IN SELECT value FROM jsonb_array_elements(p_proposal->'records') LOOP
  SELECT array_agg(x ORDER BY x) INTO record_refs FROM jsonb_array_elements_text(p_record_refs->(r->>'id')) x;
  SELECT array_agg('source-'||id||'-'||source_revision||'-'||source_generation
   ORDER BY 'source-'||id||'-'||source_revision||'-'||source_generation) INTO record_keys
  FROM vc.st_message_source WHERE owner_user_id=p_owner AND source_ref=ANY(record_refs);
  IF jsonb_typeof(r->'source_message_ids') IS DISTINCT FROM 'array'
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(r->'source_message_ids') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string')
  THEN RAISE EXCEPTION 'memorycore record source keys invalid'; END IF;
  SELECT array_agg(x ORDER BY x) INTO supplied_keys FROM jsonb_array_elements_text(r->'source_message_ids') x;
  IF supplied_keys IS DISTINCT FROM record_keys OR NOT EXISTS(SELECT 1 FROM vc.st_message_source
   WHERE owner_user_id=p_owner AND source_ref=ANY(record_refs) AND role='user' AND conversation_id=conv) THEN
   RAISE EXCEPTION 'memorycore record requires referenced user source';
  END IF;
  IF r ? 'conflictTargetIds' AND jsonb_typeof(r->'conflictTargetIds') IS DISTINCT FROM 'array' THEN
   RAISE EXCEPTION 'memorycore record targets invalid';
  END IF;
  SELECT COALESCE(array_agg(x),'{}') INTO record_targets FROM jsonb_array_elements_text(COALESCE(r->'conflictTargetIds','[]')) x;
  IF EXISTS(SELECT 1 FROM unnest(record_targets) x WHERE x IS NULL OR NOT x=ANY(target_ids))
   OR cardinality(record_targets)<>(SELECT count(DISTINCT x) FROM unnest(record_targets) x)
  THEN RAISE EXCEPTION 'memorycore record targets invalid'; END IF;
  -- Every genuinely referenced old target keeps its complete evidence.
  -- Inheritance never broadens the allowed direct assistant conversation;
  -- extraction-window membership is additionally verified by the Go caller.
  IF EXISTS(SELECT 1 FROM vc.memory_item m JOIN vc.memory_evidence e ON(e.owner_user_id,e.memory_item_id)=(m.owner_user_id,m.id)
   WHERE m.owner_user_id=p_owner AND m.engine_record_id=ANY(record_targets) AND NOT e.source_ref=ANY(record_refs)) THEN
   RAISE EXCEPTION 'memorycore inherited evidence missing';
  END IF;
  IF EXISTS(SELECT 1 FROM vc.st_message_source src WHERE src.owner_user_id=p_owner AND src.source_ref=ANY(record_refs)
   AND src.role='assistant' AND src.conversation_id<>conv) THEN
   RAISE EXCEPTION 'memorycore assistant source scope invalid';
  END IF;
  metadata:=CASE WHEN jsonb_typeof(r->'metadata')='object' THEN r->'metadata' ELSE '{}'::jsonb END;
  metadata:=metadata||jsonb_build_object('source_message_ids',to_jsonb(record_keys),'vcDependencies',to_jsonb(record_keys));
  records:=records||jsonb_build_array(r||jsonb_build_object('metadata',metadata,'source_message_ids',to_jsonb(record_keys)));
 END LOOP;
 -- V290 treats every operation target as replaced. The new overload requires
 -- an explicit per-record declaration for each target before changing any row.
 IF EXISTS(SELECT 1 FROM unnest(target_ids) target_id WHERE NOT EXISTS(
  SELECT 1 FROM jsonb_array_elements(records) rec
   CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(rec->'conflictTargetIds','[]')) declared_id
  WHERE declared_id=target_id)) THEN RAISE EXCEPTION 'memorycore target not referenced'; END IF;
 p_proposal:=(p_proposal-'cleanup_retained_record_ids')||jsonb_build_object(
  'records',records,'dependencies',to_jsonb(all_keys),'record_source_refs',p_record_refs);

 FOR r IN SELECT value FROM jsonb_array_elements(p_proposal->'records') LOOP
  mid:=nextval('vc.memory_id_seq');
  INSERT INTO vc.memory_item(owner_user_id,id,relationship_id,scope,summary,status,conversation_id,auto_saved,engine_record_id,engine_version,engine_operation_id)
  VALUES(p_owner,mid,op.relationship_id,'RELATIONSHIP',r->>'content','ACCEPTED',conv,true,r->>'id',(r->>'version')::bigint,op.operation_id);
  -- supersedes is singular: among this record's declared targets, retain the
  -- lowest database id (and its management version), independent of list order.
  UPDATE vc.memory_item n SET supersedes_memory_id=old.id, management_version=old.management_version+1
   FROM (SELECT id,management_version FROM vc.memory_item WHERE owner_user_id=p_owner AND engine_record_id IN(SELECT value FROM jsonb_array_elements_text(COALESCE(r->'conflictTargetIds','[]'))) ORDER BY id LIMIT 1) old
   WHERE n.owner_user_id=p_owner AND n.id=mid;
  FOR ref IN SELECT value FROM jsonb_array_elements_text(p_record_refs->(r->>'id')) LOOP
   INSERT INTO vc.memory_evidence(owner_user_id,id,memory_item_id,source_ref) VALUES(p_owner,nextval('vc.memory_id_seq'),mid,ref);
  END LOOP;
 END LOOP;
 -- Several new facts may declare the same target. Its reverse link chooses
 -- the declaring record with the bytewise-smallest record id, not batch order.
 UPDATE vc.memory_item old SET superseded_at=clock_timestamp(),superseded_by_memory_id=replacement.id
 FROM (
  SELECT DISTINCT ON (declared_id) declared_id,n.id
  FROM jsonb_array_elements(p_proposal->'records') rec
   CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(rec->'conflictTargetIds','[]')) declared_id
   JOIN vc.memory_item n ON n.owner_user_id=p_owner AND n.engine_operation_id=op.operation_id AND n.engine_record_id=rec->>'id'
  ORDER BY declared_id,n.engine_record_id COLLATE "C"
 ) replacement
 WHERE old.owner_user_id=p_owner AND old.engine_record_id=replacement.declared_id;
 IF jsonb_array_length(COALESCE(p_proposal->'targets','[]'))>0 THEN
 UPDATE vc.conversation_summary cs SET valid=false WHERE cs.owner_user_id=p_owner AND EXISTS(
 SELECT 1 FROM vc.memory_evidence e JOIN vc.memory_item m ON(m.owner_user_id,m.id)=(e.owner_user_id,e.memory_item_id)
 WHERE m.owner_user_id=p_owner AND m.engine_record_id IN(SELECT value->>'id' FROM jsonb_array_elements(p_proposal->'targets')) AND e.source_ref=ANY(cs.st_source_refs));
 END IF;
 UPDATE vc.memorycore_operation SET state='PUBLISHED',proposal=p_proposal WHERE owner_user_id=p_owner AND job_id=p_job;
END; $$;

-- Complete native cleanup without losing the surviving facts' future fences.
-- The caller keeps this owner memory barrier across PG validation, native
-- cleanup/readback and this final call. Acquiring it again is transaction-local.
CREATE FUNCTION vc.go_memorycore_cleaned(p_owner bigint,p_job bigint,p_retained_record_ids text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE
 op vc.memorycore_operation; m vc.memory_item; origin vc.conversation; source vc.st_message_source;
 r jsonb; ref text; authority text; raw_revision bigint; raw_deleted boolean;
 retained text[]; valid_ids text[] := '{}'; expected_refs text[]; actual_refs text[];
 expected_keys text[]; keys text[]; dependencies text[] := '{}'; primary_key text;
 valid boolean; legacy boolean; records jsonb := '[]'; refs_map jsonb := '{}'; metadata jsonb;
 invalid_ids bigint[] := '{}';
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 PERFORM vc.memory_write_barrier(p_owner);
 IF p_retained_record_ids IS NULL
  OR EXISTS(SELECT 1 FROM unnest(p_retained_record_ids) x WHERE x IS NULL OR x='')
  OR cardinality(p_retained_record_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_retained_record_ids) x)
 THEN RAISE EXCEPTION 'memorycore retained records invalid'; END IF;
 SELECT COALESCE(array_agg(x ORDER BY x),'{}') INTO retained FROM unnest(p_retained_record_ids) x;
 SELECT * INTO op FROM vc.memorycore_operation WHERE owner_user_id=p_owner AND job_id=p_job FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'memorycore operation invalid'; END IF;
 IF op.state='CLEANED' AND cardinality(retained)=0 THEN RETURN; END IF;
 IF op.state='PUBLISHED' AND op.proposal->'cleanup_retained_record_ids'=to_jsonb(retained) THEN RETURN; END IF;
 IF op.state<>'REVOKED' THEN RAISE EXCEPTION 'memorycore cleanup state invalid'; END IF;
 IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'memorycore owner deletion is in progress'; END IF;
 SELECT a.authority INTO authority FROM vc.chat_authority a WHERE a.owner_user_id=p_owner FOR SHARE;
 authority:=COALESCE(authority,'ST');
 IF authority='FROZEN' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore source temporarily unavailable';
 END IF;
 IF op.proposal IS NOT NULL AND jsonb_typeof(op.proposal->'records') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore cleanup evidence cannot be verified';
 END IF;
 legacy:=NOT COALESCE(op.proposal ? 'record_source_refs',false);
 IF NOT legacy AND jsonb_typeof(op.proposal->'record_source_refs') IS DISTINCT FROM 'object' THEN
  RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore cleanup evidence cannot be verified';
 END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(COALESCE(op.proposal->'records','[]')) LOOP
  SELECT * INTO m FROM vc.memory_item WHERE owner_user_id=p_owner AND relationship_id=op.relationship_id
   AND engine_operation_id=op.operation_id AND engine_record_id=r->>'id'
   AND engine_version=(r->>'version')::bigint FOR SHARE;
  -- Unpublished native rows and replaced/deleted projections are never kept.
  IF NOT FOUND OR m.deleted_at IS NOT NULL OR m.superseded_at IS NOT NULL OR m.source_invalidated_at IS NOT NULL
   OR m.status<>'ACCEPTED' THEN CONTINUE; END IF;
  SELECT COALESCE(array_agg(DISTINCT e.source_ref ORDER BY e.source_ref),'{}') INTO actual_refs
   FROM vc.memory_evidence e WHERE e.owner_user_id=p_owner AND e.memory_item_id=m.id;
  valid:=cardinality(actual_refs)>0;
  expected_refs:='{}'; expected_keys:='{}'; keys:='{}';
  IF legacy THEN
   -- Old six-argument publication bound the whole verified batch to every
   -- record. Its existing proposal.dependencies is that complete source-key
   -- set (ValidateEngineProposal already required equality before staging).
   IF valid AND (jsonb_typeof(op.proposal->'dependencies') IS DISTINCT FROM 'array'
    OR jsonb_array_length(op.proposal->'dependencies')=0) THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore cleanup evidence cannot be verified';
   END IF;
   IF jsonb_typeof(op.proposal->'dependencies')='array' THEN
    SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}') INTO expected_keys
     FROM jsonb_array_elements_text(op.proposal->'dependencies') x;
   END IF;
  ELSE
   IF jsonb_typeof(op.proposal->'record_source_refs'->(r->>'id')) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore cleanup evidence cannot be verified';
   END IF;
   SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}') INTO expected_refs
    FROM jsonb_array_elements_text(op.proposal->'record_source_refs'->(r->>'id')) x;
   valid:=valid AND cardinality(expected_refs)>0 AND actual_refs=expected_refs;
  END IF;
  -- A missing evidence row is a definite incomplete projection, not an
  -- inference from a temporary write guard. Never retain the remaining subset.
  IF NOT valid THEN invalid_ids:=array_append(invalid_ids,m.id); CONTINUE; END IF;
  FOREACH ref IN ARRAY actual_refs LOOP
   SELECT * INTO origin FROM vc.conversation
    WHERE owner_user_id=p_owner AND st_chat_identity=split_part(ref,':',2) FOR SHARE;
   IF NOT FOUND OR origin.relationship_id<>op.relationship_id OR origin.incognito THEN
    valid:=false; EXIT;
   END IF;
   IF authority='GO' THEN
    SELECT sc.revision,sc.deleted_at IS NOT NULL INTO raw_revision,raw_deleted FROM vc.stored_chat sc
     WHERE sc.owner_user_id=p_owner AND sc.conversation_id=origin.id AND sc.chat_id::text=origin.st_chat_identity;
    IF NOT FOUND THEN
     IF origin.incognito AND origin.st_source_state='DELETED' THEN valid:=false; EXIT; END IF;
     RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore source temporarily unavailable';
    END IF;
    IF raw_deleted THEN valid:=false; EXIT; END IF;
    IF origin.st_source_state IS DISTINCT FROM 'PRESENT' OR origin.st_applied_revision IS DISTINCT FROM raw_revision THEN
     RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore source temporarily unavailable';
    END IF;
   ELSIF origin.st_source_state='DELETED' THEN valid:=false; EXIT;
   ELSIF origin.st_source_state IS DISTINCT FROM 'PRESENT' THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore source temporarily unavailable';
   END IF;
   SELECT * INTO source FROM vc.st_message_source WHERE owner_user_id=p_owner AND source_ref=ref FOR SHARE;
   IF NOT FOUND OR NOT source.present OR NOT source.eligible OR source.suppressed THEN valid:=false; EXIT; END IF;
   IF NOT source.settled THEN
    RAISE EXCEPTION USING ERRCODE='40001',MESSAGE='memorycore source temporarily unavailable';
   END IF;
   -- Use permanent source validity here, deliberately NOT the write guard.
   IF NOT vc.guard_st_memory_source(p_owner,op.relationship_id,ref) THEN valid:=false; EXIT; END IF;
   keys:=array_append(keys,'source-'||source.id||'-'||source.source_revision||'-'||source.source_generation);
  END LOOP;
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}') INTO keys FROM unnest(keys) x;
  IF legacy THEN valid:=valid AND cardinality(expected_keys)>0 AND keys=expected_keys; END IF;
  IF NOT valid THEN invalid_ids:=array_append(invalid_ids,m.id); CONTINUE; END IF;
  valid_ids:=array_append(valid_ids,m.engine_record_id);
  dependencies:=dependencies||keys;
  refs_map:=refs_map||jsonb_build_object(m.engine_record_id,to_jsonb(actual_refs));
  -- Keep the cleanup manifest, not old extraction input, embeddings or targets.
  -- Native records themselves are cleaned/read back by the caller before this
  -- completion; these fields are the actual future source-fence consumers.
  primary_key:=r#>>'{metadata,vcPrimarySourceId}';
  -- A legacy record may not carry a primary key; never choose an assistant
  -- merely because its decimal source id sorts before the referenced user.
  IF primary_key IS NULL OR NOT EXISTS(SELECT 1 FROM vc.st_message_source s
   WHERE s.owner_user_id=p_owner AND s.source_ref=ANY(actual_refs) AND s.role='user'
    AND 'source-'||s.id||'-'||s.source_revision||'-'||s.source_generation=primary_key) THEN
   SELECT 'source-'||s.id||'-'||s.source_revision||'-'||s.source_generation INTO primary_key
    FROM vc.st_message_source s WHERE s.owner_user_id=p_owner AND s.source_ref=ANY(actual_refs) AND s.role='user'
    ORDER BY s.id LIMIT 1;
  END IF;
  metadata:=jsonb_strip_nulls(jsonb_build_object('vcScopeKey',r#>'{metadata,vcScopeKey}',
   'vcPrimarySourceId',primary_key,'vcDependencies',to_jsonb(keys),'source_message_ids',to_jsonb(keys)));
  records:=records||jsonb_build_array(jsonb_build_object('id',r->'id','content',to_jsonb(m.summary),'version',m.engine_version,
   'source_message_ids',to_jsonb(keys),'conflictTargetIds','[]'::jsonb,'metadata',metadata));
 END LOOP;
 SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}') INTO valid_ids FROM unnest(valid_ids) x;
 IF retained IS DISTINCT FROM valid_ids THEN RAISE EXCEPTION 'memorycore retained record set mismatch'; END IF;
 -- Incomplete evidence has no deletion trigger. Invalidate just that projection;
 -- do not call delete_memory or suppress still-valid sources shared by siblings.
 UPDATE vc.memory_item SET source_invalidated_at=clock_timestamp()
  WHERE owner_user_id=p_owner AND id=ANY(invalid_ids) AND source_invalidated_at IS NULL;
 IF cardinality(valid_ids)=0 THEN
  UPDATE vc.memorycore_operation SET state='CLEANED',proposal=NULL WHERE owner_user_id=p_owner AND job_id=p_job;
 ELSE
  SELECT COALESCE(array_agg(DISTINCT x ORDER BY x),'{}') INTO dependencies FROM unnest(dependencies) x;
  UPDATE vc.memorycore_operation SET state='PUBLISHED',proposal=jsonb_build_object(
   'records',records,'targets','[]'::jsonb,'dependencies',to_jsonb(dependencies),
   'record_source_refs',refs_map,'cleanup_retained_record_ids',to_jsonb(valid_ids))
   WHERE owner_user_id=p_owner AND job_id=p_job;
 END IF;
END $$;

REVOKE ALL ON FUNCTION vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[],jsonb),
 vc.go_memorycore_cleaned(bigint,bigint,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[],jsonb),
 vc.go_memorycore_cleaned(bigint,bigint,text[]) TO vc_api,vc_worker;
