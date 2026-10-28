-- W08: memory contents are plaintext; retain column names, owner checks and RLS.
-- Run with companiond migrate: the Go conversion and schema history commit in
-- this same transaction. Stop old writers first; finish pending account deletion.
SET search_path=vc,pg_catalog;

DROP FUNCTION vc.record_encrypted_conversation_summary(bigint,bigint,bigint,bigint,text,text,text,text,real,boolean,text);
DROP FUNCTION vc.conversation_summary_cipher_ready(text);
DROP FUNCTION vc.backfill_stale_cipher_summary_batch(bigint,integer,text);
DROP FUNCTION vc.backfill_replace_summary_cipher(bigint,bigint,text,text);
GRANT EXECUTE ON FUNCTION vc.record_conversation_summary(bigint,bigint,bigint,bigint,text,text,text,text,real,boolean,text) TO vc_api;

CREATE OR REPLACE FUNCTION vc.set_memory_temporal(p_owner bigint,p_memory bigint,p_cipher text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.memory_item SET temporal_cipher=p_cipher WHERE owner_user_id=p_owner AND id=p_memory;
END;
$$;

CREATE OR REPLACE FUNCTION vc.record_st_summary(p_owner bigint,p_conversation bigint,p_refs text[],p_cipher text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE prior vc.conversation_summary%ROWTYPE; rel bigint; ref text; result bigint;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.memory_write_barrier(p_owner);
    SELECT relationship_id INTO rel FROM vc.conversation WHERE owner_user_id=p_owner AND id=p_conversation AND st_mode='COMPANION' FOR UPDATE;
    IF NOT FOUND OR cardinality(p_refs) NOT BETWEEN 1 AND 12 OR p_cipher IS NULL OR btrim(p_cipher)='' THEN RETURN 0; END IF;
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

-- Runtime cannot open until the data conversion and history are committed.
CREATE FUNCTION vc.memory_plaintext_ready() RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    RETURN EXISTS(SELECT 1 FROM public.vc_schema_history WHERE version=146);
END;
$$;
REVOKE ALL ON FUNCTION vc.memory_plaintext_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_plaintext_ready() TO vc_api,vc_worker;
COMMENT ON COLUMN vc.memory_item.temporal_cipher IS 'W08 plaintext JSON; legacy column name retained';
COMMENT ON COLUMN vc.st_message_source.content_cipher IS 'W08 plaintext source snapshot; legacy column name retained';
