-- W08: MemoryCore is the only production extractor. Go owns publication fences.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.memory_item ADD COLUMN engine_record_id text, ADD COLUMN engine_version bigint,
 ADD COLUMN engine_operation_id text;
UPDATE vc.conversation_summary SET valid=false;
CREATE UNIQUE INDEX memorycore_record_projection ON vc.memory_item(owner_user_id,engine_record_id) WHERE engine_record_id IS NOT NULL;
CREATE TABLE vc.memorycore_scope (
 owner_user_id bigint NOT NULL, relationship_id bigint NOT NULL, revision bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(owner_user_id,relationship_id),
 FOREIGN KEY(owner_user_id,relationship_id) REFERENCES vc.relationship(owner_user_id,id) ON DELETE CASCADE);
CREATE TABLE vc.memorycore_operation (
 owner_user_id bigint NOT NULL, job_id bigint NOT NULL, relationship_id bigint NOT NULL, source_id bigint NOT NULL,
 operation_id text NOT NULL, profile_operation_id text, scope jsonb NOT NULL, revision bigint NOT NULL, proposal jsonb,
 state text NOT NULL DEFAULT 'NEW' CHECK(state IN ('NEW','PROPOSED','PUBLISHED','REVOKED','CLEANED')),
 PRIMARY KEY(owner_user_id,job_id), UNIQUE(owner_user_id,operation_id),
 FOREIGN KEY(owner_user_id,relationship_id) REFERENCES vc.relationship(owner_user_id,id) ON DELETE CASCADE);
ALTER TABLE vc.memorycore_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memorycore_scope FORCE ROW LEVEL SECURITY;
ALTER TABLE vc.memorycore_operation ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.memorycore_operation FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_isolation ON vc.memorycore_scope TO vc_api,vc_worker USING(owner_user_id=vc.current_owner_id()) WITH CHECK(owner_user_id=vc.current_owner_id());
CREATE POLICY owner_isolation ON vc.memorycore_operation TO vc_api,vc_worker USING(owner_user_id=vc.current_owner_id()) WITH CHECK(owner_user_id=vc.current_owner_id());
REVOKE ALL ON vc.memorycore_scope,vc.memorycore_operation FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON vc.memorycore_scope,vc.memorycore_operation TO vc_api,vc_worker;
GRANT EXECUTE ON FUNCTION vc.go_service_resolve_embedding_config(bigint) TO vc_worker;

CREATE FUNCTION vc.memorycore_source_fence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE rel bigint;
BEGIN
 IF ROW(NEW.source_ref,NEW.present,NEW.eligible,NEW.suppressed) IS DISTINCT FROM ROW(OLD.source_ref,OLD.present,OLD.eligible,OLD.suppressed) THEN
  SELECT relationship_id INTO rel FROM vc.conversation WHERE owner_user_id=NEW.owner_user_id AND id=NEW.conversation_id;
  INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id,revision) VALUES(NEW.owner_user_id,rel,1)
   ON CONFLICT(owner_user_id,relationship_id) DO UPDATE SET revision=memorycore_scope.revision+1;
 UPDATE vc.memorycore_operation SET state='REVOKED' WHERE owner_user_id=NEW.owner_user_id AND relationship_id=rel AND (state IN ('NEW','PROPOSED') OR (state='PUBLISHED' AND (source_id=OLD.id OR proposal->'dependencies' ? ('source-'||OLD.id||'-'||OLD.source_revision||'-'||OLD.source_generation))));
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER memorycore_source_fence AFTER UPDATE ON vc.st_message_source FOR EACH ROW EXECUTE FUNCTION vc.memorycore_source_fence();
REVOKE ALL ON FUNCTION vc.memorycore_source_fence() FROM PUBLIC;

CREATE FUNCTION vc.go_memorycore_projection(p_owner bigint,p_rel bigint)
RETURNS TABLE(memory_id bigint,record_id text,version bigint,operation_id text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 RETURN QUERY SELECT m.id,m.engine_record_id,m.engine_version,m.engine_operation_id FROM vc.memory_item m
 WHERE m.owner_user_id=p_owner AND m.relationship_id=p_rel AND m.engine_record_id IS NOT NULL;
END; $$;
REVOKE ALL ON FUNCTION vc.go_memorycore_projection(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_memorycore_projection(bigint,bigint) TO vc_api,vc_worker;

CREATE FUNCTION vc.go_publish_memorycore(p_owner bigint,p_job bigint,p_token text,p_fence text,p_proposal jsonb,p_refs text[])
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
  IF NOT vc.guard_st_memory_source(p_owner,op.relationship_id,ref) THEN RAISE EXCEPTION 'memorycore source invalid'; END IF;
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
REVOKE ALL ON FUNCTION vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_publish_memorycore(bigint,bigint,text,text,jsonb,text[]) TO vc_worker,vc_api;

-- Retire pending legacy jobs, preserving attempts and already-accounted usage.
UPDATE vc.work_item SET status='CANCELLED',claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL,finished_at=clock_timestamp()
 WHERE kind='MEMORY_EXTRACT' AND status IN ('PENDING','CLAIMED');
UPDATE vc.memory_extract_attempt SET status='ABANDONED',billing_disposition='UNKNOWN',terminal_at=clock_timestamp(),output_payload=NULL
 WHERE status='CREATED' AND memorycore_operation_id IS NULL;
CREATE OR REPLACE FUNCTION vc.enqueue_memory_extract(p_owner_user_id bigint,p_generation_id bigint) RETURNS bigint
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$ BEGIN PERFORM vc.go_assert_owner(p_owner_user_id); RETURN NULL; END; $$;
-- No runtime role can write or query the retired parallel vector index.
DELETE FROM vc.memory_embedding;
REVOKE ALL ON vc.memory_embedding FROM vc_api,vc_worker,vc_job_coordinator,vc_dispatcher;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='vc'::regnamespace AND
 (proname IN ('upsert_memory_embedding','recall_memory_semantic','semantic_recall','retire_embedding_space') OR proname LIKE '%reembed%') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM vc_api,vc_worker,vc_job_coordinator,vc_dispatcher',f.signature);
 END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION vc.go_claim_jobs(
    p_generation_lease_seconds integer,
    p_export_lease_seconds integer,
    p_default_lease_seconds integer,
    p_limit integer,
    p_generation_limit integer,
    p_extract_limit integer)
    RETURNS TABLE(
        out_owner_user_id bigint,
        out_job_id bigint,
        out_kind text,
        out_ref_id bigint,
        out_claim_token text,
        out_claim_fence text,
        out_lease_seconds integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit integer;
    v_gen_limit integer;
    v_extract_limit integer;
BEGIN
    IF p_generation_lease_seconds IS NULL OR p_generation_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: generation lease must be >= 5s';
    END IF;
    IF p_export_lease_seconds IS NULL OR p_export_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: export lease must be >= 5s';
    END IF;
    IF p_default_lease_seconds IS NULL OR p_default_lease_seconds < 5 THEN
        RAISE EXCEPTION 'go_claim_jobs: default lease must be >= 5s';
    END IF;
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 32);
    v_gen_limit := CASE
        WHEN p_generation_limit IS NULL THEN NULL
        ELSE GREATEST(p_generation_limit, 0)
    END;
    v_extract_limit := CASE
        WHEN p_extract_limit IS NULL THEN NULL
        ELSE GREATEST(p_extract_limit, 0)
    END;

    RETURN QUERY
    WITH gen_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'GENERATION'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_gen_limit
    ),
    export_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'DATA_EXPORT'
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_limit
    ),
    extract_picked AS (
        SELECT wi.owner_user_id, wi.id, wi.created_at
          FROM vc.work_item wi
         WHERE wi.status = 'PENDING'
           AND wi.kind = 'ST_MEMORY_EXTRACT'
           AND (EXISTS (SELECT 1 FROM vc.st_message_source s WHERE s.owner_user_id=wi.owner_user_id AND s.id=wi.ref_id AND s.settled))
           AND (wi.next_attempt_at IS NULL OR wi.next_attempt_at <= clock_timestamp())
         ORDER BY wi.created_at, wi.id
         FOR UPDATE SKIP LOCKED
         LIMIT v_extract_limit
    ),
    picked AS (
        SELECT owner_user_id, id
          FROM (
              SELECT * FROM gen_picked
              UNION ALL SELECT * FROM export_picked
              UNION ALL SELECT * FROM extract_picked
          ) u
         ORDER BY created_at, id
         LIMIT v_limit
    )
    UPDATE vc.work_item wi
       SET status = 'CLAIMED',
           claim_token = gen_random_uuid()::text,
           claim_fence = gen_random_uuid()::text,
           claimed_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs =>
               CASE wi.kind
                   WHEN 'GENERATION' THEN p_generation_lease_seconds
                   WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                   ELSE p_default_lease_seconds
               END)
      FROM picked p
     WHERE wi.owner_user_id = p.owner_user_id AND wi.id = p.id
    RETURNING wi.owner_user_id, wi.id, wi.kind, wi.ref_id, wi.claim_token, wi.claim_fence,
              CASE wi.kind
                  WHEN 'GENERATION' THEN p_generation_lease_seconds
                  WHEN 'DATA_EXPORT' THEN p_export_lease_seconds
                  ELSE p_default_lease_seconds
              END;
END;
$$;


CREATE FUNCTION vc.go_record_memorycore_profile(p_owner bigint,p_job bigint,p_token text,p_fence text,p_refs text[],p_text text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE op vc.memorycore_operation; conv bigint; ref text; prior bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 SELECT * INTO op FROM vc.memorycore_operation WHERE owner_user_id=p_owner AND job_id=p_job AND state='PUBLISHED';
 IF NOT FOUND THEN RAISE EXCEPTION 'profile operation missing'; END IF;
 PERFORM 1 FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=op.relationship_id AND revision=op.revision FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM vc.work_item WHERE owner_user_id=p_owner AND id=p_job AND status='CLAIMED' AND claim_token=p_token AND claim_fence=p_fence AND lease_expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'profile claim lost'; END IF;
 FOREACH ref IN ARRAY p_refs LOOP
  IF NOT vc.guard_st_memory_source(p_owner,op.relationship_id,ref) THEN RAISE EXCEPTION 'profile source invalid'; END IF;
 END LOOP;
 IF cardinality(p_refs)=0 OR p_text='' OR length(p_text)>16000 THEN RAISE EXCEPTION 'profile invalid'; END IF;
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

 -- An older retried profile must not replace a newer extraction snapshot.
 IF EXISTS(SELECT 1 FROM vc.memorycore_operation newer JOIN vc.st_message_source src ON(src.owner_user_id,src.id)=(newer.owner_user_id,newer.source_id)
 WHERE newer.owner_user_id=p_owner AND newer.job_id>p_job AND newer.state='PUBLISHED' AND src.conversation_id=conv AND (jsonb_array_length(COALESCE(newer.proposal->'records','[]'))>0 OR jsonb_array_length(COALESCE(newer.proposal->'targets','[]'))>0)) THEN RETURN; END IF;
 SELECT id INTO prior FROM vc.conversation_summary WHERE owner_user_id=p_owner AND conversation_id=conv ORDER BY id DESC LIMIT 1;
 UPDATE vc.conversation_summary SET valid=false WHERE owner_user_id=p_owner AND conversation_id=conv;
 INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,prev_id,st_source_refs)
 VALUES(p_owner,nextval('vc.conversation_summary_id_seq'),conv,p_text,'memorycore','084bed45','st-memorycore-profile-v1',1,'ECONOMY',prior,p_refs);
END; $$;
REVOKE ALL ON FUNCTION vc.go_record_memorycore_profile(bigint,bigint,text,text,text[],text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_record_memorycore_profile(bigint,bigint,text,text,text[],text) TO vc_api,vc_worker;
CREATE FUNCTION vc.go_revoked_memorycore_operations() RETURNS TABLE(owner_id bigint,job_id bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT owner_user_id,job_id FROM vc.memorycore_operation WHERE state='REVOKED' ORDER BY job_id LIMIT 32;
$$;
REVOKE ALL ON FUNCTION vc.go_revoked_memorycore_operations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_revoked_memorycore_operations() TO vc_api,vc_worker;

REVOKE INSERT,UPDATE ON vc.memorycore_scope,vc.memorycore_operation FROM vc_api,vc_worker;
CREATE FUNCTION vc.go_memorycore_scope(p_owner bigint,p_rel bigint) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE rev bigint;
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 INSERT INTO vc.memorycore_scope(owner_user_id,relationship_id) VALUES(p_owner,p_rel) ON CONFLICT DO NOTHING;
 SELECT revision INTO rev FROM vc.memorycore_scope WHERE owner_user_id=p_owner AND relationship_id=p_rel;
 RETURN rev;
END; $$;
CREATE FUNCTION vc.go_memorycore_reserve(p_owner bigint,p_job bigint,p_rel bigint,p_source bigint,p_operation text,p_scope jsonb,p_revision bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 IF NOT EXISTS(SELECT 1 FROM vc.work_item w JOIN vc.st_message_source s ON(s.owner_user_id,s.id)=(w.owner_user_id,w.ref_id)
 JOIN vc.conversation c ON(c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
 WHERE w.owner_user_id=p_owner AND w.id=p_job AND w.kind='ST_MEMORY_EXTRACT' AND w.ref_id=p_source AND c.relationship_id=p_rel)
 THEN RAISE EXCEPTION 'memorycore source job mismatch'; END IF;
 INSERT INTO vc.memorycore_operation(owner_user_id,job_id,relationship_id,source_id,operation_id,scope,revision)
 VALUES(p_owner,p_job,p_rel,p_source,p_operation,p_scope,p_revision)
 ON CONFLICT(owner_user_id,job_id) DO UPDATE SET
 operation_id=CASE WHEN memorycore_operation.state='CLEANED' THEN excluded.operation_id ELSE memorycore_operation.operation_id END,
 scope=excluded.scope,revision=excluded.revision,
 proposal=CASE WHEN memorycore_operation.state='CLEANED' THEN NULL ELSE memorycore_operation.proposal END,
 state=CASE WHEN memorycore_operation.state='CLEANED' THEN 'NEW' ELSE 'PUBLISHED' END,
 profile_operation_id=CASE WHEN memorycore_operation.state='CLEANED' THEN NULL ELSE memorycore_operation.operation_id||'-profile-r'||excluded.revision END
 WHERE memorycore_operation.state='CLEANED' OR (memorycore_operation.state='PUBLISHED' AND memorycore_operation.revision<>excluded.revision);
END; $$;
CREATE FUNCTION vc.go_memorycore_stage(p_owner bigint,p_job bigint,p_proposal jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner); PERFORM vc.memory_write_barrier(p_owner);
 UPDATE vc.memorycore_operation SET proposal=p_proposal,state='PROPOSED' WHERE owner_user_id=p_owner AND job_id=p_job AND state IN('NEW','PROPOSED');
END; $$;
CREATE FUNCTION vc.go_memorycore_cleaned(p_owner bigint,p_job bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.memorycore_operation SET state='CLEANED',proposal=NULL WHERE owner_user_id=p_owner AND job_id=p_job AND state='REVOKED';
END; $$;
REVOKE ALL ON FUNCTION vc.go_memorycore_scope(bigint,bigint),vc.go_memorycore_reserve(bigint,bigint,bigint,bigint,text,jsonb,bigint),vc.go_memorycore_stage(bigint,bigint,jsonb),vc.go_memorycore_cleaned(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_memorycore_scope(bigint,bigint),vc.go_memorycore_reserve(bigint,bigint,bigint,bigint,text,jsonb,bigint),vc.go_memorycore_stage(bigint,bigint,jsonb),vc.go_memorycore_cleaned(bigint,bigint) TO vc_api,vc_worker;
CREATE FUNCTION vc.go_memorycore_failed(p_owner bigint,p_job bigint,p_token text,p_fence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF EXISTS(SELECT 1 FROM vc.work_item WHERE owner_user_id=p_owner AND id=p_job AND status='CLAIMED' AND claim_token=p_token AND claim_fence=p_fence) THEN
 UPDATE vc.memorycore_operation SET state='REVOKED' WHERE owner_user_id=p_owner AND job_id=p_job AND state IN('NEW','PROPOSED');
 END IF;
END; $$;
CREATE FUNCTION vc.go_retry_memorycore_profile(p_owner bigint,p_job bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.memorycore_operation o SET profile_operation_id=o.operation_id||'-profile-a'||(w.attempt_count+1)
 FROM vc.work_item w WHERE o.owner_user_id=p_owner AND o.job_id=p_job AND w.owner_user_id=p_owner AND w.id=p_job AND o.state='PUBLISHED';
END; $$;
REVOKE ALL ON FUNCTION vc.go_memorycore_failed(bigint,bigint,text,text),vc.go_retry_memorycore_profile(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_memorycore_failed(bigint,bigint,text,text),vc.go_retry_memorycore_profile(bigint,bigint) TO vc_api,vc_worker;

-- Engine profiles may summarize several chats. W07's summary-origin gate
-- remains, and every dependency now independently passes that same target gate.
CREATE OR REPLACE FUNCTION vc.read_st_summaries(p_owner bigint,p_conversations bigint[],p_target bigint)
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

-- Reuse one existing published source job per owner to rebuild changed spaces.
-- The operation stays PUBLISHED: this never replays L1 extraction.
CREATE FUNCTION vc.go_enqueue_memorycore_rebuilds(p_actor bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_admin_assert_provider_actor(p_actor);
 IF NOT EXISTS(SELECT 1 FROM vc.embedding_config WHERE state='ENABLED') THEN RETURN; END IF;
 UPDATE vc.work_item w SET status='PENDING',attempt_count=0,next_attempt_at=NULL,finished_at=NULL,
 claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL
 FROM (SELECT DISTINCT ON(o.owner_user_id) o.owner_user_id,o.job_id FROM vc.memorycore_operation o
 JOIN vc.st_message_source s ON(s.owner_user_id,s.id)=(o.owner_user_id,o.source_id)
 JOIN vc.work_item j ON(j.owner_user_id,j.id)=(o.owner_user_id,o.job_id)
 WHERE o.state='PUBLISHED' AND s.present AND s.eligible AND s.settled AND NOT s.suppressed
 AND j.status IN('DONE','FAILED','DEAD_LETTERED') AND NOT EXISTS(SELECT 1 FROM vc.account_deletion_intent d WHERE d.account_id=o.owner_user_id AND d.status='REQUESTED')
 ORDER BY o.owner_user_id,o.job_id DESC) selected
 WHERE w.owner_user_id=selected.owner_user_id AND w.id=selected.job_id;
END; $$;
REVOKE ALL ON FUNCTION vc.go_enqueue_memorycore_rebuilds(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_enqueue_memorycore_rebuilds(bigint) TO vc_api;

-- Replace the pre-dependency W06 blanket invalidation, retaining its CAS/source logic.
CREATE OR REPLACE FUNCTION vc.apply_st_source_snapshot_v142(
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
        -- W08 profiles carry complete dependencies. A new unrelated message or
        -- an empty proposal does not invalidate an already verified profile.
        UPDATE vc.conversation_summary cs SET valid=false WHERE cs.owner_user_id=p_owner AND cs.valid
          AND (cs.st_source_refs IS NULL OR EXISTS(SELECT 1 FROM unnest(cs.st_source_refs) AS dep(source_ref)
          WHERE NOT EXISTS(SELECT 1 FROM vc.st_message_source src WHERE src.owner_user_id=p_owner
            AND src.source_ref=dep.source_ref AND src.present AND src.eligible AND NOT src.suppressed)));
    END IF;
    RETURN p_state;
END;
$$;
