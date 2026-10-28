-- W07: query/summary APIs retain the owner boundary, branch filtering precedes
-- candidate exposure, and summary provenance cannot survive source forgetting.
\set ON_ERROR_STOP on
TRUNCATE vc.vc_user CASCADE;
INSERT INTO vc.vc_user(id,display_name) VALUES(1,'alice'),(2,'bob');
BEGIN;
SELECT vc.set_owner_context(1,'w07',encode(vc.hmac(convert_to('vc-owner-binding-v1|1|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|w07','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE a record; b record; summary_id bigint; memory_id bigint; n integer; ref text;
BEGIN
    SELECT * INTO a FROM vc.resolve_st_binding(1,'w07-root','card','COMPANION',NULL,'');
    SELECT * INTO b FROM vc.resolve_st_binding(1,'w07-branch','card','COMPANION',a.out_relationship_id,'');
    PERFORM vc.apply_st_source_snapshot(1,'w07-root',NULL,1,'PRESENT','root.jsonl',
      '[{"messageId":"11111111-1111-4111-8111-111111111111","candidateId":"22222222-2222-4222-8222-222222222222","revision":1,"role":"user","cipher":"synthetic plaintext source","settled":true,"eligible":true,"sourceTimestamp":"2026-10-20T12:00:00Z","sourceTimezone":"Asia/Shanghai"}]','w07-root');
    PERFORM vc.apply_st_source_snapshot(1,'w07-branch',NULL,1,'PRESENT','branch.jsonl','[]','w07-root');
    SELECT source_ref INTO ref FROM vc.st_message_source WHERE owner_user_id=1 AND conversation_id=a.out_conversation_id;
    memory_id:=vc.create_memory_candidate_keyed(1,a.out_relationship_id,'RELATIONSHIP','synthetic plaintext source',a.out_conversation_id,ARRAY[ref],NULL,NULL,NULL,'w07-memory');
    PERFORM vc.confirm_memory_candidate(1,memory_id,NULL);
    PERFORM vc.set_memory_temporal(1,memory_id,'{"eventDate":"2026-10-30","sourceTimezone":"Asia/Shanghai"}');
    IF vc.get_memory_temporal(1,memory_id) IS DISTINCT FROM '{"eventDate":"2026-10-30","sourceTimezone":"Asia/Shanghai"}' THEN RAISE EXCEPTION 'time metadata lost'; END IF;
    SELECT count(*) INTO n FROM vc.query_memory_candidates(1,a.out_relationship_id,a.out_conversation_id,'RELATIONSHIP',0);
    IF n<>1 THEN RAISE EXCEPTION 'own candidate missing'; END IF;
    SELECT count(*) INTO n FROM vc.query_memory_candidates(1,a.out_relationship_id,b.out_conversation_id,'RELATIONSHIP',0);
    IF n<>0 THEN RAISE EXCEPTION 'parent branch leaked'; END IF;
    summary_id:=vc.record_st_summary(1,a.out_conversation_id,ARRAY[ref],'synthetic plaintext summary');
    IF summary_id<=0 OR vc.record_st_summary(1,a.out_conversation_id,ARRAY[ref],'unchanged dependencies')<>summary_id THEN RAISE EXCEPTION 'stable dependencies duplicated summary'; END IF;
    SELECT count(*) INTO n FROM vc.read_st_summaries(1,ARRAY[a.out_conversation_id],a.out_conversation_id);
    IF n<>1 THEN RAISE EXCEPTION 'verified summary missing'; END IF;
    IF (SELECT out_summary FROM vc.read_st_summaries(1,ARRAY[a.out_conversation_id],a.out_conversation_id)) IS DISTINCT FROM 'synthetic plaintext summary' THEN
        RAISE EXCEPTION 'summary plaintext was changed';
    END IF;
    PERFORM vc.delete_memory(1,memory_id);
    SELECT count(*) INTO n FROM vc.read_st_summaries(1,ARRAY[a.out_conversation_id],a.out_conversation_id);
    IF n<>0 THEN RAISE EXCEPTION 'forgotten source survived summary'; END IF;
    BEGIN
        PERFORM vc.set_memory_temporal(2,memory_id,'{}');
        RAISE EXCEPTION 'forged temporal owner accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM<>'p_owner_user_id does not match server-trusted current_owner_id' THEN RAISE; END IF;
    END;
    BEGIN
        PERFORM vc.query_memory_candidates(2,a.out_relationship_id,a.out_conversation_id,'RELATIONSHIP',0);
        RAISE EXCEPTION 'forged owner accepted';
    EXCEPTION WHEN raise_exception THEN
        IF SQLERRM='forged owner accepted' THEN RAISE; END IF;
    END;
END;
$$;
COMMIT;
RESET ROLE;
BEGIN;
SELECT vc.set_owner_context(2,'w07b',encode(vc.hmac(convert_to('vc-owner-binding-v1|2|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|w07b','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$
DECLARE n integer;
BEGIN
    SELECT count(*) INTO n FROM vc.st_message_source WHERE owner_user_id=1;
    IF n<>0 THEN RAISE EXCEPTION 'source time leaked through RLS'; END IF;
    SELECT count(*) INTO n FROM vc.read_st_summaries(2,ARRAY[1::bigint],1);
    IF n<>0 THEN RAISE EXCEPTION 'foreign summary leaked'; END IF;
END;
$$;
COMMIT;
RESET ROLE;
