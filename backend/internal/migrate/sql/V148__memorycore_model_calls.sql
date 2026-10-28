-- W08-3: every controlled MemoryCore LLM call uses the existing extraction
-- attempt and cost ledger. No production queue/recall cutover is performed.
SET search_path=vc,pg_catalog;

-- Sampling controls are model capabilities, not merely protocol field names.
CREATE OR REPLACE FUNCTION vc.go_model_capabilities_valid(p jsonb)
    RETURNS boolean
    LANGUAGE sql
    IMMUTABLE
AS $$
    SELECT p IS NOT NULL AND jsonb_typeof(p) = 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) e
            WHERE e.key NOT IN ('imageInput', 'videoInput', 'pdfInput',
                                'structuredOutput', 'toolCalls',
                                'nativeWebSearch', 'systemMessage', 'temperature', 'topP')
               OR jsonb_typeof(e.value) <> 'string'
               OR (e.value #>> '{}') NOT IN (
                   'UNKNOWN', 'DECLARED', 'VERIFIED', 'UNSUPPORTED'))
$$;

ALTER TABLE vc.memory_extract_attempt
 ADD COLUMN memorycore_operation_id text,
 ADD COLUMN memorycore_stage text,
 ADD COLUMN memorycore_call_sequence integer,
 ADD CONSTRAINT memorycore_call_shape CHECK (
   (memorycore_operation_id IS NULL AND memorycore_stage IS NULL AND memorycore_call_sequence IS NULL)
   OR (memorycore_operation_id IS NOT NULL AND memorycore_stage IS NOT NULL AND memorycore_call_sequence IS NOT NULL AND length(memorycore_operation_id) BETWEEN 1 AND 128
       AND memorycore_stage IN ('l1-extraction','l1-conflict-detection','l2-scene','l3-persona')
       AND memorycore_call_sequence BETWEEN 1 AND 32));
CREATE UNIQUE INDEX memorycore_call_once ON vc.memory_extract_attempt(owner_user_id,work_item_id,memorycore_operation_id,memorycore_call_sequence)
 WHERE memorycore_operation_id IS NOT NULL;

CREATE FUNCTION vc.go_prepare_memorycore_call(
 p_owner bigint,p_job bigint,p_source bigint,p_token text,p_fence text,
 p_operation text,p_stage text,p_sequence integer,p_provider text,p_supplier text,p_model text)
RETURNS TABLE(out_attempt_id bigint,out_attempt_no integer,out_decision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE v record;
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_operation IS NULL OR length(p_operation) NOT BETWEEN 1 AND 128
    OR p_stage IS NULL OR p_stage NOT IN ('l1-extraction','l1-conflict-detection','l2-scene','l3-persona')
    OR p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 32 THEN
   RAISE EXCEPTION 'invalid memorycore call';
 END IF;
 -- Serialize calls for this job before existing admission abandons a CREATED
 -- attempt. A still-running call must never be overtaken by another stage.
 PERFORM 1 FROM vc.work_item WHERE owner_user_id=p_owner AND id=p_job FOR UPDATE;
 IF EXISTS(SELECT 1 FROM vc.memory_extract_attempt WHERE owner_user_id=p_owner AND work_item_id=p_job
     AND (status='CREATED' OR (memorycore_operation_id=p_operation AND memorycore_call_sequence=p_sequence))) THEN
   RETURN QUERY SELECT 0::bigint,0,'REPLAY'::text; RETURN;
 END IF;
 SELECT * INTO v FROM vc.go_prepare_st_memory_extract_attempt(p_owner,p_job,p_source,p_token,p_fence,p_provider,p_supplier,p_model);
 IF v.out_attempt_id IS NULL THEN
   RETURN QUERY SELECT 0::bigint,0,CASE WHEN v.out_decision='EXTRACTABLE' THEN 'LEGACY_REPLAY' ELSE v.out_decision END; RETURN;
 END IF;
 UPDATE vc.memory_extract_attempt SET memorycore_operation_id=p_operation,memorycore_stage=p_stage,memorycore_call_sequence=p_sequence
 WHERE owner_user_id=p_owner AND id=v.out_attempt_id;
 RETURN QUERY SELECT v.out_attempt_id,v.out_attempt_no,v.out_decision;
END;
$$;
REVOKE ALL ON FUNCTION vc.go_prepare_memorycore_call(bigint,bigint,bigint,text,text,text,text,integer,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_prepare_memorycore_call(bigint,bigint,bigint,text,text,text,text,integer,text,text,text) TO vc_api,vc_worker;
