-- Forget holds the owner memory barrier while it cancels source work.
-- Acquire the same barrier before locking the work item to prepare a call.
SET search_path=vc,pg_catalog;

CREATE OR REPLACE FUNCTION vc.go_prepare_memorycore_call(
 p_owner bigint,p_job bigint,p_source bigint,p_token text,p_fence text,
 p_operation text,p_stage text,p_sequence integer,p_provider text,p_supplier text,p_model text)
RETURNS TABLE(out_attempt_id bigint,out_attempt_no integer,out_decision text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE v record; v_retry record;
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF p_operation IS NULL OR length(p_operation) NOT BETWEEN 1 AND 128
    OR p_stage IS NULL OR p_stage NOT IN ('l1-extraction','l1-conflict-detection','l2-scene','l3-persona')
    OR p_sequence IS NULL OR p_sequence NOT BETWEEN 1 AND 32 THEN
   RAISE EXCEPTION 'invalid memorycore call';
 END IF;
 PERFORM vc.memory_write_barrier(p_owner);
 PERFORM 1 FROM vc.work_item WHERE owner_user_id=p_owner AND id=p_job FOR UPDATE;
 IF EXISTS(SELECT 1 FROM vc.memory_extract_attempt WHERE owner_user_id=p_owner AND work_item_id=p_job AND status='CREATED') THEN
   RETURN QUERY SELECT 0::bigint,0,'REPLAY'::text; RETURN;
 END IF;
 SELECT id,attempt_no,status,failure_code INTO v_retry FROM vc.memory_extract_attempt
  WHERE owner_user_id=p_owner AND work_item_id=p_job AND memorycore_operation_id=p_operation AND memorycore_call_sequence=p_sequence
  FOR UPDATE;
 IF FOUND THEN
   IF v_retry.status='FAILED' AND v_retry.failure_code IN ('TIMEOUT_CONNECT','TIMEOUT_FIRST_TOKEN','TIMEOUT_TOTAL') THEN
     IF NOT EXISTS (
        SELECT 1 FROM vc.work_item wi
         WHERE wi.owner_user_id=p_owner AND wi.id=p_job AND wi.kind='ST_MEMORY_EXTRACT' AND wi.ref_id=p_source
           AND wi.status='CLAIMED' AND wi.claim_token=p_token AND wi.claim_fence=p_fence AND wi.lease_expires_at>clock_timestamp()
     ) THEN
       RETURN QUERY SELECT 0::bigint,0,'CLAIM_LOST'::text; RETURN;
     END IF;
     IF p_sequence>1 AND NOT EXISTS (
        SELECT 1 FROM vc.memory_extract_attempt
         WHERE owner_user_id=p_owner AND work_item_id=p_job AND memorycore_operation_id=p_operation
           AND memorycore_call_sequence=p_sequence-1 AND status='SUCCEEDED') THEN
       RETURN QUERY SELECT 0::bigint,0,'REPLAY'::text; RETURN;
     END IF;
     UPDATE vc.memory_extract_attempt
        SET status='CREATED', failure_code=NULL, terminal_at=NULL, billing_disposition=NULL, input_tokens=NULL, output_tokens=NULL
      WHERE owner_user_id=p_owner AND id=v_retry.id AND status='FAILED';
     RETURN QUERY SELECT v_retry.id, v_retry.attempt_no, 'RETRY_TIMEOUT'::text; RETURN;
   END IF;
   RETURN QUERY SELECT 0::bigint,0,'REPLAY'::text; RETURN;
 END IF;
 IF p_sequence>1 AND NOT EXISTS (
    SELECT 1 FROM vc.memory_extract_attempt
     WHERE owner_user_id=p_owner AND work_item_id=p_job AND memorycore_operation_id=p_operation
       AND memorycore_call_sequence=p_sequence-1 AND status='SUCCEEDED') THEN
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
