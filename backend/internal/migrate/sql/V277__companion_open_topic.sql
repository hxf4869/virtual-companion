-- One reference reuses the current source lifecycle and owner RLS; no text copy.
ALTER TABLE vc.companion_affect ADD COLUMN open_topic_source_ref text;

CREATE FUNCTION vc.set_companion_topic(p_owner bigint, p_relationship bigint, p_ref text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_ref IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM vc.st_message_source s JOIN vc.conversation c
          ON (c.owner_user_id,c.id)=(s.owner_user_id,s.conversation_id)
         WHERE s.owner_user_id=p_owner AND c.relationship_id=p_relationship
           AND s.source_ref=p_ref AND s.role='user' AND s.present AND s.settled
           AND s.eligible AND NOT s.suppressed AND NOT c.incognito
           AND c.st_mode='COMPANION' AND c.st_source_state='PRESENT') THEN
        RETURN; -- Opted-out or concurrently invalidated sources cannot open a topic.
    END IF;
    UPDATE vc.companion_affect SET open_topic_source_ref=p_ref
     WHERE owner_user_id=p_owner AND relationship_id=p_relationship;
    IF NOT FOUND THEN RAISE EXCEPTION 'proactive: affect not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION vc.set_companion_topic(bigint,bigint,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.set_companion_topic(bigint,bigint,text) TO vc_api,vc_worker;

-- Runtime roles have SELECT, not arbitrary UPDATE, on this queue. Acquire the
-- existing delivery row lock through the owner-checked definer boundary.
CREATE FUNCTION vc.lock_ready_proactive(p_owner bigint,p_relationship bigint)
RETURNS TABLE(out_id bigint,out_reminder boolean,out_body text,out_planned timestamptz,
              out_armed timestamptz,out_kind text,out_topic text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=vc,pg_catalog AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    RETURN QUERY SELECT m.id,m.reminder,m.body,m.planned_at,m.armed_at,m.kind,COALESCE(m.topic,'')
      FROM vc.proactive_message m
     WHERE m.owner_user_id=p_owner AND m.relationship_id=p_relationship AND m.status='READY'
     ORDER BY m.planned_at FOR UPDATE;
END;
$$;
REVOKE ALL ON FUNCTION vc.lock_ready_proactive(bigint,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.lock_ready_proactive(bigint,bigint) TO vc_api,vc_worker;
