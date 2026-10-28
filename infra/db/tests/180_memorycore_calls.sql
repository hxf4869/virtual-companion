-- W08-3 narrow call metadata inherits the existing forced owner RLS.
\set ON_ERROR_STOP on
INSERT INTO vc.vc_user(id,display_name) VALUES (14801,'synthetic mc owner'),(14802,'synthetic other') ON CONFLICT DO NOTHING;
INSERT INTO vc.memory_extract_attempt(owner_user_id,id,work_item_id,st_source_ref,attempt_no,provider_id,supplier_name,model_id,allowed_categories,memorycore_operation_id,memorycore_stage,memorycore_call_sequence)
VALUES (14801,1480101,14801,'synthetic:source',1,'synthetic','Synthetic','synthetic',ARRAY['MESSAGE_TEXT'],'op','l1-extraction',1);
DO $$ BEGIN
 BEGIN
  INSERT INTO vc.memory_extract_attempt(owner_user_id,id,work_item_id,st_source_ref,attempt_no,provider_id,supplier_name,model_id,allowed_categories,memorycore_operation_id,memorycore_stage,memorycore_call_sequence)
  VALUES (14801,1480102,14801,'synthetic:source',2,'synthetic','Synthetic','synthetic',ARRAY['MESSAGE_TEXT'],'op','l2-scene',1);
  RAISE EXCEPTION 'duplicate sequence must fail';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
BEGIN;
SELECT vc.set_owner_context(14802,'mc',encode(vc.hmac(convert_to('vc-owner-binding-v1|14802|'||pg_backend_pid()||'|'||pg_current_xact_id()||'|mc','UTF8'),convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id=1),'UTF8'),'sha256'),'hex'));
SET LOCAL ROLE vc_api;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM vc.memory_extract_attempt WHERE owner_user_id=14801) THEN RAISE EXCEPTION 'cross owner call leaked'; END IF;
 BEGIN
  PERFORM * FROM vc.go_prepare_memorycore_call(14801,14801,14801,'token','fence','op','l1-extraction',2,'synthetic','Synthetic','synthetic');
  RAISE EXCEPTION 'cross owner prepare must fail';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%owner%' THEN RAISE; END IF;
 END;
END $$;
COMMIT;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='vc' AND c.relname='memory_extract_attempt' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)) THEN RAISE EXCEPTION 'call ledger RLS disabled'; END IF;
END $$;

-- The model capability validator accepts the two explicit sampling controls,
-- preserves the closed key/status vocabulary, and does not infer support from
-- a numeric generation parameter alone.
DO $$ BEGIN
 IF NOT vc.go_model_capabilities_valid('{"temperature":"DECLARED","topP":"UNSUPPORTED"}'::jsonb)
    OR NOT vc.go_model_capabilities_valid('{"temperature":"VERIFIED","topP":"UNKNOWN"}'::jsonb) THEN
   RAISE EXCEPTION 'sampling capability states rejected';
 END IF;
 IF vc.go_model_capabilities_valid('{"temperature":"true"}'::jsonb)
    OR vc.go_model_capabilities_valid('{"topP":true}'::jsonb)
    OR vc.go_model_capabilities_valid('{"arbitraryParameter":"DECLARED"}'::jsonb) THEN
   RAISE EXCEPTION 'open capability vocabulary accepted';
 END IF;
END $$;
