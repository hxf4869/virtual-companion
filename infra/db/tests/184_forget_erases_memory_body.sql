-- Forgotten memories keep a tombstone, but the body is gone from the row,
-- the management projection, evidence excerpts, and same-relationship summaries.
\set ON_ERROR_STOP on
TRUNCATE vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id,display_name) VALUES(1,'alice'),(2,'bob');
BEGIN;
SELECT vc.set_owner_context(1,'w08erase',encode(vc.hmac(convert_to('vc-owner-binding-v1|1|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|w08erase','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE daily record; other record; ref text; other_ref text; memory_id bigint; kept_id bigint; ev jsonb;
        fact text:='用户计划于2026年10月30日去厦门参加朋友婚礼';
        source_text text:='原始聊天里的婚礼句子不应留在证据投影';
BEGIN
    SELECT * INTO daily FROM vc.resolve_st_binding(1,'w08-erase-root','card','COMPANION',NULL,'');
    SELECT * INTO other FROM vc.resolve_st_binding(1,'w08-erase-other','card','COMPANION',NULL,'');
    PERFORM vc.apply_st_source_snapshot(1,'w08-erase-root',NULL,1,'PRESENT','root.jsonl',
      '[{"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"原始聊天里的婚礼句子不应留在证据投影","settled":true,"eligible":true,"sourceTimestamp":"2026-10-20T12:00:00Z","sourceTimezone":"Asia/Shanghai"}]','w08-erase');
    PERFORM vc.apply_st_source_snapshot(1,'w08-erase-other',NULL,1,'PRESENT','other.jsonl',
      '[{"messageId":"33333333-3333-4333-8333-333333333333","candidateId":"44444444-4444-4444-8444-444444444444","revision":1,"role":"user","cipher":"另一段关系的原文","settled":true,"eligible":true,"sourceTimestamp":"2026-10-20T12:00:00Z","sourceTimezone":"Asia/Shanghai"}]','w08-erase');
    SELECT source_ref INTO ref FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=daily.out_conversation_id;
    SELECT source_ref INTO other_ref FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=other.out_conversation_id;
    memory_id:=vc.create_memory_candidate_keyed(1,daily.out_relationship_id,'RELATIONSHIP',fact,daily.out_conversation_id,ARRAY[ref],NULL,NULL,NULL,'w08-erase-memory');
    PERFORM vc.confirm_memory_candidate(1,memory_id,NULL);
    kept_id:=vc.create_memory_candidate_keyed(1,daily.out_relationship_id,'RELATIONSHIP','兄弟事实仍应保留',daily.out_conversation_id,ARRAY[ref],NULL,NULL,NULL,'w08-erase-kept');
    PERFORM vc.confirm_memory_candidate(1,kept_id,NULL);
    IF vc.record_st_summary(1,daily.out_conversation_id,ARRAY[ref],fact)<=0 THEN RAISE EXCEPTION 'derived summary missing'; END IF;
    IF vc.record_st_summary(1,other.out_conversation_id,ARRAY[other_ref],fact)<=0 THEN RAISE EXCEPTION 'cross relationship summary missing'; END IF;
    SELECT jsonb_agg(v) INTO ev FROM vc.memory_management_evidence(1,memory_id) v;
    IF position(source_text in ev::text)=0 THEN RAISE EXCEPTION 'evidence excerpt missing before forget'; END IF;
END $$;
RESET ROLE;
UPDATE vc.memory_item SET correction_summary='纠正稿中的紫藤花暗号'
 WHERE owner_user_id=1 AND idempotency_key='w08-erase-memory';
INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,valid,st_source_refs)
SELECT 1,nextval('vc.conversation_summary_id_seq'),c.id,'转述：用户计划于2026年10月30日去厦门参加朋友婚礼','extractive','1','st-source-digest-v1',1,'ECONOMY',true,ARRAY['st:unrelated-wording']
  FROM vc.conversation c WHERE c.owner_user_id=1 AND c.st_chat_identity='w08-erase-root';
INSERT INTO vc.conversation_summary(owner_user_id,id,conversation_id,summary,model_id,model_version,prompt_version,confidence,service_class,valid,st_source_refs)
SELECT 1,nextval('vc.conversation_summary_id_seq'),c.id,'只含纠正稿中的紫藤花暗号','extractive','1','st-source-digest-v1',1,'ECONOMY',true,ARRAY['st:unrelated-correction']
  FROM vc.conversation c WHERE c.owner_user_id=1 AND c.st_chat_identity='w08-erase-root';
SELECT set_config('w08.memory_id',m.id::text,true) FROM vc.memory_item m WHERE m.owner_user_id=1 AND m.idempotency_key='w08-erase-memory';
SELECT set_config('w08.kept_id',m.id::text,true) FROM vc.memory_item m WHERE m.owner_user_id=1 AND m.idempotency_key='w08-erase-kept';
SELECT set_config('w08.rel_id',m.relationship_id::text,true) FROM vc.memory_item m WHERE m.owner_user_id=1 AND m.idempotency_key='w08-erase-memory';
SELECT id AS forgotten_id FROM vc.memory_item WHERE owner_user_id=1 AND idempotency_key='w08-erase-memory' \gset
SET LOCAL ROLE vc_api;
DO $$
DECLARE memory_id bigint:=current_setting('w08.memory_id')::bigint; kept_id bigint:=current_setting('w08.kept_id')::bigint; rel bigint:=current_setting('w08.rel_id')::bigint;
        row jsonb; leaked text;
        fact text:='用户计划于2026年10月30日去厦门参加朋友婚礼';
        source_text text:='原始聊天里的婚礼句子不应留在证据投影';
        correction text:='纠正稿中的紫藤花暗号';
BEGIN
    IF NOT vc.memory_forget_begin(1,memory_id) THEN RAISE EXCEPTION 'forget failed'; END IF;
    row:=vc.memory_management_detail(1,memory_id);
    IF row->>'lifecycle'<>'FORGETTING' OR row->>'summary'<>'' OR row->>'recallEligible'<>'false' THEN RAISE EXCEPTION 'tombstone missing'; END IF;
    IF position(fact in row::text)>0 OR position(source_text in row::text)>0 OR position(correction in row::text)>0 THEN RAISE EXCEPTION 'detail still holds forgotten body'; END IF;
    IF EXISTS (SELECT 1 FROM vc.memory_management_list(1,rel,'','','','',0,30) item WHERE item->>'memoryId'=memory_id::text AND item->>'summary'<>'') THEN RAISE EXCEPTION 'list summary not erased'; END IF;
    IF EXISTS (SELECT 1 FROM vc.memory_management_list(1,rel,fact,'','','',0,30) item WHERE item->>'memoryId'=memory_id::text) THEN RAISE EXCEPTION 'forgotten body still searchable'; END IF;
    SELECT string_agg(item::text,' ') INTO leaked FROM vc.memory_management_list(1,rel,'','','','',0,30) item;
    IF position(fact in coalesce(leaked,''))>0 OR position(correction in coalesce(leaked,''))>0 THEN RAISE EXCEPTION 'list still holds forgotten body'; END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.memory_management_list(1,rel,'','','','',0,30) item WHERE item->>'memoryId'=kept_id::text AND item->>'summary'='兄弟事实仍应保留') THEN RAISE EXCEPTION 'kept memory body erased'; END IF;
    IF EXISTS (SELECT 1 FROM vc.memory_management_evidence(1,memory_id) item WHERE item->>'excerpt'<>'' OR position(fact in item::text)>0 OR position(source_text in item::text)>0) THEN RAISE EXCEPTION 'evidence still holds forgotten body'; END IF;
    PERFORM vc.memory_cleanup_finish(1,memory_id,'DONE');
    row:=vc.memory_management_detail(1,memory_id);
    IF row->>'lifecycle'<>'FORGOTTEN' OR row->>'summary'<>'' OR position(fact in row::text)>0 THEN RAISE EXCEPTION 'forgotten tombstone restored body'; END IF;
END $$;
RESET ROLE;
DO $$
DECLARE body text; correction text; cipher text; cross_summary text; kept text; quoted int; root_left int;
        fact text:='用户计划于2026年10月30日去厦门参加朋友婚礼';
BEGIN
    SELECT m.summary,m.correction_summary INTO body,correction FROM vc.memory_item m WHERE m.owner_user_id=1 AND m.idempotency_key='w08-erase-memory';
    IF body<>'' OR correction IS NOT NULL THEN RAISE EXCEPTION 'forgotten columns still hold body'; END IF;
    SELECT m.summary INTO kept FROM vc.memory_item m WHERE m.owner_user_id=1 AND m.idempotency_key='w08-erase-kept';
    IF kept<>'兄弟事实仍应保留' THEN RAISE EXCEPTION 'kept column erased'; END IF;
    SELECT content_cipher INTO cipher FROM vc.st_message_source WHERE owner_user_id=1 AND content_cipher LIKE '原始聊天里的婚礼句子%';
    IF cipher IS NULL THEN RAISE EXCEPTION 'source chat was deleted'; END IF;
    SELECT cs.summary INTO cross_summary FROM vc.conversation_summary cs
      JOIN vc.conversation c ON (c.owner_user_id,c.id)=(cs.owner_user_id,cs.conversation_id)
     WHERE cs.owner_user_id=1 AND c.st_chat_identity='w08-erase-other' AND cs.summary=fact;
    IF cross_summary IS NULL THEN RAISE EXCEPTION 'cross relationship summary erased'; END IF;
    SELECT count(*) INTO quoted FROM vc.conversation_summary cs WHERE cs.owner_user_id=1 AND (position(fact in cs.summary)>0 OR position('紫藤花暗号' in cs.summary)>0);
    IF quoted<>1 THEN RAISE EXCEPTION 'same relationship wording survived or cross summary lost: %', quoted; END IF;
    SELECT count(*) INTO root_left FROM vc.conversation_summary cs
      JOIN vc.conversation c ON (c.owner_user_id,c.id)=(cs.owner_user_id,cs.conversation_id)
     WHERE cs.owner_user_id=1 AND c.st_chat_identity='w08-erase-root' AND btrim(cs.summary)<>'';
    IF root_left<>0 THEN RAISE EXCEPTION 'relationship summaries still readable'; END IF;
END $$;
COMMIT;
RESET ROLE;
BEGIN;
SELECT vc.set_owner_context(2,'w08erase-b',encode(vc.hmac(convert_to('vc-owner-binding-v1|2|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|w08erase-b','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
SELECT format($f$
DO $body$
BEGIN
    IF vc.memory_management_detail(1, %s) IS NOT NULL OR vc.memory_management_detail(2, %s) IS NOT NULL THEN RAISE EXCEPTION 'foreign detail disclosed'; END IF;
    IF EXISTS (SELECT 1 FROM vc.memory_management_evidence(1, %s)) THEN RAISE EXCEPTION 'foreign evidence disclosed'; END IF;
END
$body$;
$f$, :'forgotten_id', :'forgotten_id', :'forgotten_id') \gexec
COMMIT;
RESET ROLE;
