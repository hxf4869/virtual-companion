-- W10-T4: cross-owner inbox projection list, and deletion-domain clears.
-- The list is granted only to vc_worker. Clears run only while the current
-- owner has a deletion intent, and only for vc.current_owner_id() rows.
-- Notification rows are cleared before inbox rows because deliveries reference
-- inbox events.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.list_inbox_projections()
    RETURNS TABLE(
        out_owner bigint,
        out_action text,
        out_event_id text,
        out_conversation_id bigint,
        out_branch text,
        out_source_revision bigint,
        out_expires_at timestamptz,
        out_chat_identity text,
        out_intent text)
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
    SELECT f.owner_user_id,
           'create'::text,
           f.event_id,
           c.id,
           NULL::text,
           c.st_applied_revision::bigint,
           NULL::timestamptz,
           c.st_chat_identity,
           CASE WHEN f.status = 'WAITING_HOST' THEN 'WAITING_HOST' ELSE 'BODY' END
      FROM vc.follow_up f
      JOIN LATERAL (
            SELECT conv.id, conv.st_chat_identity, conv.st_applied_revision
              FROM vc.conversation conv
             WHERE conv.owner_user_id = f.owner_user_id
               AND conv.relationship_id = f.relationship_id
               AND conv.st_chat_identity IS NOT NULL
               AND btrim(conv.st_chat_identity) <> ''
               AND (
                    split_part(COALESCE(f.source_ref, ''), ':', 2) = conv.st_chat_identity
                    OR (
                        f.source_ref IS NULL
                        AND (
                            SELECT count(*)
                              FROM vc.conversation conv2
                             WHERE conv2.owner_user_id = f.owner_user_id
                               AND conv2.relationship_id = f.relationship_id
                               AND conv2.st_chat_identity IS NOT NULL
                               AND btrim(conv2.st_chat_identity) <> ''
                        ) = 1
                    )
               )
             ORDER BY conv.id
             LIMIT 1
      ) c ON true
     WHERE f.status IN ('BODY_READY', 'WAITING_HOST')
       AND NOT EXISTS (
            SELECT 1 FROM vc.inbox_event i
             WHERE i.owner_user_id = f.owner_user_id AND i.event_id = f.event_id)
       AND NOT EXISTS (
            SELECT 1 FROM vc.account_deletion_intent a
             WHERE a.account_id = f.owner_user_id)
    UNION ALL
    SELECT i.owner_user_id,
           'deliver'::text,
           i.event_id,
           i.conversation_id,
           i.branch,
           i.source_revision,
           i.expires_at,
           c.st_chat_identity,
           i.intent
      FROM vc.inbox_event i
      JOIN vc.conversation c
        ON c.owner_user_id = i.owner_user_id AND c.id = i.conversation_id
     WHERE i.intent = 'BODY'
       AND NOT i.st_delivered
       AND (i.lease_expires_at IS NULL OR i.lease_expires_at <= clock_timestamp())
       AND c.st_chat_identity IS NOT NULL
       AND btrim(c.st_chat_identity) <> ''
       AND NOT EXISTS (
            SELECT 1 FROM vc.account_deletion_intent a
             WHERE a.account_id = i.owner_user_id);
$$;

CREATE FUNCTION vc.clear_notification_domain_current()
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
BEGIN
    IF v_owner IS NULL OR NOT vc.account_deletion_intent_active_current() THEN
        RETURN false;
    END IF;
    DELETE FROM vc.notification_delivery WHERE owner_user_id = v_owner;
    DELETE FROM vc.notification_channel WHERE owner_user_id = v_owner;
    RETURN true;
END;
$$;

CREATE FUNCTION vc.clear_inbox_domain_current()
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint := vc.current_owner_id();
BEGIN
    IF v_owner IS NULL OR NOT vc.account_deletion_intent_active_current() THEN
        RETURN false;
    END IF;
    DELETE FROM vc.inbox_event WHERE owner_user_id = v_owner;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION vc.list_inbox_projections() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.clear_notification_domain_current() FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.clear_inbox_domain_current() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION vc.list_inbox_projections() TO vc_worker;
GRANT EXECUTE ON FUNCTION vc.clear_notification_domain_current(), vc.clear_inbox_domain_current()
    TO vc_api, vc_worker;
