-- MB-9: calls reuse owner-isolated inbox rows and their existing voice attachment.
ALTER TABLE vc.proactive_message DROP CONSTRAINT proactive_message_kind;
ALTER TABLE vc.proactive_message ADD CONSTRAINT proactive_message_kind
 CHECK (kind IN ('check_in','continue_topic','share','care','call'));
ALTER TABLE vc.inbox_event ADD COLUMN call_state text;
ALTER TABLE vc.inbox_event ADD COLUMN call_expires_at timestamptz;
ALTER TABLE vc.inbox_event ADD COLUMN call_request_id uuid;
ALTER TABLE vc.inbox_event ADD CONSTRAINT inbox_call_shape CHECK (
 (call_state IS NULL AND call_expires_at IS NULL AND call_request_id IS NULL) OR
 (call_state IS NOT NULL AND call_state IN ('RINGING','MISSED','ANSWERED','DECLINED') AND call_expires_at IS NOT NULL
  AND ((call_state IN ('ANSWERED','DECLINED')) = (call_request_id IS NOT NULL))));

CREATE FUNCTION vc.arm_inbox_call(p_owner bigint,p_event text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 UPDATE vc.inbox_event i SET call_state='RINGING',call_expires_at=clock_timestamp()+interval '30 seconds'
 WHERE i.owner_user_id=p_owner AND i.event_id=p_event AND i.intent='BODY' AND i.call_state IS NULL
 AND EXISTS(SELECT 1 FROM vc.proactive_message m WHERE m.owner_user_id=p_owner
  AND m.event_id=p_event AND m.kind='call' AND m.status='INBOX');
END $$;

CREATE FUNCTION vc.respond_inbox_call(p_owner bigint,p_event text,p_action text,p_request uuid) RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
DECLARE item vc.inbox_event; target text;
BEGIN
 PERFORM vc.go_assert_owner(p_owner);
 IF vc.account_deletion_intent_active_current() THEN RAISE EXCEPTION 'owner deletion is in progress'; END IF;
 IF p_request IS NULL OR p_action IS NULL OR p_action NOT IN ('ANSWER','DECLINE') THEN RAISE EXCEPTION 'invalid call response'; END IF;
 SELECT * INTO item FROM vc.inbox_event WHERE owner_user_id=p_owner AND event_id=p_event FOR UPDATE;
 IF NOT FOUND OR item.call_state IS NULL OR item.link_status<>'present' THEN RAISE EXCEPTION 'inbox call not found'; END IF;
 target:=CASE p_action WHEN 'ANSWER' THEN 'ANSWERED' ELSE 'DECLINED' END;
 IF item.call_state<>'RINGING' THEN RETURN item.call_state=target AND item.call_request_id=p_request; END IF;
 IF item.call_expires_at<=clock_timestamp() THEN
  UPDATE vc.inbox_event SET call_state='MISSED' WHERE owner_user_id=p_owner AND event_id=p_event;
  RETURN false;
 END IF;
 UPDATE vc.inbox_event SET call_state=target,call_request_id=p_request,
  read_at=COALESCE(read_at,clock_timestamp()) WHERE owner_user_id=p_owner AND event_id=p_event;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION vc.arm_inbox_call(bigint,text),vc.respond_inbox_call(bigint,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.arm_inbox_call(bigint,text),vc.respond_inbox_call(bigint,text,text,uuid) TO vc_api;
