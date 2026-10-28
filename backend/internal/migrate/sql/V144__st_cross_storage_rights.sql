-- W06: extend the existing deletion intent; retain the ST locator until all
-- online domains have acknowledged cleanup. No new deletion queue or platform.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.account_deletion_intent ADD COLUMN st_status text NOT NULL DEFAULT 'NOT_APPLICABLE'
    CHECK(st_status IN ('NOT_APPLICABLE','PENDING','COMPLETED')),
    ADD COLUMN st_handle text;
CREATE FUNCTION vc.require_st_account_deletion_current() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    UPDATE vc.account_deletion_intent SET st_status='PENDING'
     WHERE account_id=vc.current_owner_id() AND status='REQUESTED' AND st_status='NOT_APPLICABLE';
END;
$$;
CREATE FUNCTION vc.get_st_account_deletion_current() RETURNS TABLE(out_status text,out_st_status text,out_st_handle text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT status,st_status,st_handle FROM vc.account_deletion_intent WHERE account_id=vc.current_owner_id();
$$;
CREATE FUNCTION vc.complete_st_account_deletion_current(p_handle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF p_handle IS NULL OR p_handle !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'invalid ST cleanup locator'; END IF;
    UPDATE vc.account_deletion_intent SET st_status='COMPLETED',st_handle=p_handle
     WHERE account_id=vc.current_owner_id() AND st_status='PENDING' AND (st_handle IS NULL OR st_handle=p_handle);
END;
$$;
CREATE FUNCTION vc.pending_account_deletions(p_limit integer) RETURNS TABLE(out_owner bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT account_id FROM vc.account_deletion_intent WHERE status='REQUESTED' ORDER BY requested_at,account_id LIMIT LEAST(GREATEST(p_limit,1),32);
$$;
CREATE FUNCTION vc.guard_cross_storage_account_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    IF EXISTS(SELECT 1 FROM vc.account_deletion_intent WHERE account_id=OLD.id AND st_status='PENDING')
       OR ((EXISTS(SELECT 1 FROM vc.identity_account WHERE id=OLD.id AND st_handle IS NOT NULL)
            OR EXISTS(SELECT 1 FROM vc.conversation WHERE owner_user_id=OLD.id AND st_chat_identity IS NOT NULL))
           AND NOT EXISTS(SELECT 1 FROM vc.account_deletion_intent WHERE account_id=OLD.id AND st_status='COMPLETED')) THEN
        RAISE EXCEPTION 'ST account cleanup is pending';
    END IF;
    RETURN OLD;
END;
$$;
CREATE TRIGGER st_cleanup_before_account_delete BEFORE DELETE ON vc.vc_user FOR EACH ROW EXECUTE FUNCTION vc.guard_cross_storage_account_delete();
REVOKE ALL ON FUNCTION vc.require_st_account_deletion_current(),vc.get_st_account_deletion_current(),vc.complete_st_account_deletion_current(text),vc.pending_account_deletions(integer),vc.guard_cross_storage_account_delete() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.require_st_account_deletion_current(),vc.get_st_account_deletion_current(),vc.complete_st_account_deletion_current(text),vc.pending_account_deletions(integer) TO vc_api,vc_worker;

-- The same pending export resumes when the ST service returns. No file is
-- advertised as complete while a promised domain is unavailable.
CREATE FUNCTION vc.defer_export_for_st(p_owner bigint,p_job bigint,p_token text,p_fence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.assert_active_claim(p_owner,p_job,p_token,p_fence);
    UPDATE vc.work_item SET status='PENDING',claim_token=NULL,claim_fence=NULL,claimed_at=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp()+interval '1 minute'
     WHERE owner_user_id=p_owner AND id=p_job AND kind='DATA_EXPORT';
    IF NOT FOUND THEN RAISE EXCEPTION 'export job not found'; END IF;
    UPDATE vc.export_request e SET error_message='ST_UNAVAILABLE' WHERE e.owner_user_id=p_owner AND e.id=(SELECT ref_id FROM vc.work_item WHERE owner_user_id=p_owner AND id=p_job) AND e.status='PENDING';
END;
$$;
REVOKE ALL ON FUNCTION vc.defer_export_for_st(bigint,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.defer_export_for_st(bigint,bigint,text,text) TO vc_api,vc_worker;

-- Only current product domains are promised. Shared provider credentials,
-- authentication secrets, export objects and offline backups are excluded.
CREATE FUNCTION vc.export_v2_owner_metadata(p_owner bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN jsonb_build_object(
      'capturedAt',clock_timestamp(),
      'memoryAutoSave',vc.get_memory_auto_save_pref(p_owner),
      'reminders',COALESCE((SELECT jsonb_agg(jsonb_build_object('reminderId',r.id::text,'relationshipId',r.relationship_id::text,'text',r.text,'remindAt',r.remind_at,'recurrence',r.recurrence,'status',r.status)) FROM vc.reminder r WHERE r.owner_user_id=p_owner),'[]'::jsonb),
      'consents',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('consentId',c.out_id::text,'consentType',c.out_consent_type,'version',c.out_version,'granted',c.out_granted,'grantedAt',c.out_granted_at,'revokedAt',c.out_revoked_at))) FROM vc.list_consents(p_owner) c),'[]'::jsonb),
      'instances',COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM vc.relationship r WHERE r.owner_user_id=p_owner),'[]'::jsonb),
      'bindings',COALESCE((SELECT jsonb_agg(jsonb_build_object('conversationId',c.id::text,'instanceId',c.relationship_id::text,'chatIdentity',c.st_chat_identity,'mode',c.st_mode,'revision',c.st_applied_revision,'state',c.st_source_state,'location',c.st_location,'incognito',c.incognito)) FROM vc.conversation c WHERE c.owner_user_id=p_owner AND c.st_chat_identity IS NOT NULL),'[]'::jsonb),
      'sources',COALESCE((SELECT jsonb_agg(jsonb_build_object('sourceId',s.id::text,'conversationId',s.conversation_id::text,'sourceRef',s.source_ref,'role',s.role,'content',s.content_cipher,'present',s.present,'settled',s.settled,'eligible',s.eligible,'suppressed',s.suppressed)) FROM vc.st_message_source s WHERE s.owner_user_id=p_owner),'[]'::jsonb),
      'evidence',COALESCE((SELECT jsonb_agg(jsonb_build_object('memoryId',e.memory_item_id::text,'sourceRef',e.source_ref,'createdAt',e.created_at,'invalidatedAt',m.source_invalidated_at)) FROM vc.memory_evidence e JOIN vc.memory_item m ON (m.owner_user_id,m.id)=(e.owner_user_id,e.memory_item_id) WHERE e.owner_user_id=p_owner AND m.deleted_at IS NULL),'[]'::jsonb),
      'summaries',COALESCE((SELECT jsonb_agg(jsonb_build_object('summaryId',s.id::text,'conversationId',s.conversation_id::text,'content',s.summary,'valid',s.valid,'fromMessageId',s.from_message_id::text,'toMessageId',s.to_message_id::text,'model',s.model_id,'createdAt',s.created_at)) FROM vc.conversation_summary s WHERE s.owner_user_id=p_owner),'[]'::jsonb),
      'tasks',COALESCE((SELECT jsonb_agg(jsonb_build_object('taskId',w.id::text,'kind',w.kind,'refId',w.ref_id::text,'sourceRef',w.st_source_ref,'status',w.status,'createdAt',w.created_at,'finishedAt',w.finished_at)) FROM vc.work_item w WHERE w.owner_user_id=p_owner),'[]'::jsonb),
      'extractionResults',COALESCE((SELECT jsonb_agg(jsonb_build_object('attemptId',a.id::text,'taskId',a.work_item_id::text,'generationId',a.generation_id::text,'sourceRef',a.st_source_ref,'status',a.status,'output',a.output_payload,'provider',a.provider_id,'model',a.model_id,'inputTokens',a.input_tokens,'outputTokens',a.output_tokens,'usageStatus',a.billing_disposition,'startedAt',a.attempt_started_at,'finishedAt',a.terminal_at)) FROM vc.memory_extract_attempt a WHERE a.owner_user_id=p_owner),'[]'::jsonb)
    );
END;
$$;
REVOKE ALL ON FUNCTION vc.export_v2_owner_metadata(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.export_v2_owner_metadata(bigint) TO vc_api,vc_worker;

-- A profile may contain private cards/worlds before its first chat. Register
-- that real storage domain on authenticated ST entry, not just chat binding.
ALTER TABLE vc.identity_account ADD COLUMN st_handle text CHECK(st_handle IS NULL OR st_handle ~ '^[A-Za-z0-9_-]{1,64}$');
CREATE FUNCTION vc.register_st_profile(p_owner bigint,p_handle text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE current_handle text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    PERFORM vc.go_lock_outbound_owner(p_owner);
    IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion is in progress'; END IF;
    IF p_handle IS NULL OR p_handle !~ '^[A-Za-z0-9_-]{1,64}$' THEN RAISE EXCEPTION 'invalid ST profile'; END IF;
    SELECT st_handle INTO current_handle FROM vc.identity_account WHERE id=p_owner AND status='ACTIVE' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ST profile owner is not active'; END IF;
    IF current_handle IS NOT NULL AND current_handle<>p_handle THEN RAISE EXCEPTION 'ST profile mapping conflict'; END IF;
    UPDATE vc.identity_account SET st_handle=p_handle WHERE id=p_owner AND st_handle IS NULL;
END;
$$;
CREATE OR REPLACE FUNCTION vc.require_st_account_deletion_current() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    UPDATE vc.account_deletion_intent d SET st_status='PENDING',st_handle=COALESCE(d.st_handle,(SELECT a.st_handle FROM vc.identity_account a WHERE a.id=d.account_id))
     WHERE d.account_id=vc.current_owner_id() AND d.status='REQUESTED' AND d.st_status='NOT_APPLICABLE';
END;
$$;
REVOKE ALL ON FUNCTION vc.register_st_profile(bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.register_st_profile(bigint,text) TO vc_api;

CREATE FUNCTION vc.requires_st_account_cleanup_current() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
    SELECT EXISTS(SELECT 1 FROM vc.identity_account WHERE id=vc.current_owner_id() AND st_handle IS NOT NULL)
        OR EXISTS(SELECT 1 FROM vc.conversation WHERE owner_user_id=vc.current_owner_id() AND st_chat_identity IS NOT NULL);
$$;
REVOKE ALL ON FUNCTION vc.requires_st_account_cleanup_current() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.requires_st_account_cleanup_current() TO vc_api,vc_worker;
