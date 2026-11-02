-- UX-31: pin a memory. pinned_at is the only state; recall puts pinned and still
-- recall-eligible memories first. Pinning changes no wording, so management_version
-- stays untouched and a concurrent correction is not made to conflict.
SET search_path=vc,pg_catalog;
ALTER TABLE vc.memory_item ADD COLUMN pinned_at timestamptz;

CREATE OR REPLACE FUNCTION vc.memory_management_row(p_owner bigint,p_id bigint) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT jsonb_build_object(
 'memoryId',m.id::text,'relationshipId',m.relationship_id::text,'version',m.management_version,
 'type',CASE WHEN m.event_at IS NULL THEN 'FACT' ELSE 'EVENT' END,'scope',m.scope,
 'summary',CASE WHEN m.deleted_at IS NOT NULL THEN '' ELSE m.summary END,'status',m.status,
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
 'cleanup',jsonb_build_object('state',m.cleanup_state,'detail',m.cleanup_detail),
 'pinnedAt',m.pinned_at)
 FROM vc.memory_item m LEFT JOIN vc.conversation c ON(c.owner_user_id,c.id)=(m.owner_user_id,m.conversation_id)
 WHERE p_owner=vc.current_owner_id() AND m.owner_user_id=p_owner AND m.id=p_id;
$$;

-- True when the row exists, is owned, and is neither forgotten nor superseded.
CREATE FUNCTION vc.memory_set_pin(p_owner bigint,p_id bigint,p_pinned boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.memory_item SET pinned_at=CASE WHEN p_pinned THEN COALESCE(pinned_at,clock_timestamp()) ELSE NULL END
  WHERE owner_user_id=p_owner AND id=p_id AND deleted_at IS NULL AND superseded_at IS NULL;
 RETURN FOUND;
END;
$$;

CREATE FUNCTION vc.memory_pinned_ids(p_owner bigint,p_rel bigint) RETURNS TABLE(out_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
 SELECT m.id FROM vc.memory_item m
  WHERE p_owner=vc.current_owner_id() AND m.owner_user_id=p_owner AND m.relationship_id=p_rel
    AND m.pinned_at IS NOT NULL AND m.deleted_at IS NULL AND m.superseded_at IS NULL
  ORDER BY m.pinned_at DESC,m.id DESC;
$$;
REVOKE ALL ON FUNCTION vc.memory_set_pin(bigint,bigint,boolean),vc.memory_pinned_ids(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.memory_set_pin(bigint,bigint,boolean),vc.memory_pinned_ids(bigint,bigint) TO vc_api,vc_worker;
