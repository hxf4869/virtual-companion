-- W16 review: a sending row that outlives the channel send is unknown.
-- The peer may already have the message, so this does not return the row
-- to pending. The caller supplies the age. The decision code is
-- NOTIFICATION_SENDING_UNKNOWN. Runtime roles do not execute this function;
-- the worker sweep calls it.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.abandon_notification_sending(
    p_owner bigint,
    p_id bigint,
    p_older_than_seconds integer)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_owner IS NULL OR p_owner <= 0 OR p_id IS NULL OR p_id <= 0
       OR p_older_than_seconds IS NULL OR p_older_than_seconds < 1 THEN
        RAISE EXCEPTION 'abandon_notification_sending: arguments must be positive';
    END IF;
    UPDATE vc.notification_delivery
       SET status = 'unknown',
           attempt_count = attempt_count + 1,
           next_attempt_at = NULL,
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner
       AND id = p_id
       AND status = 'sending'
       AND updated_at <= clock_timestamp() - make_interval(secs => p_older_than_seconds);
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    RETURN 'NOTIFICATION_SENDING_UNKNOWN';
END;
$$;

REVOKE ALL ON FUNCTION vc.abandon_notification_sending(bigint, bigint, integer) FROM PUBLIC;
