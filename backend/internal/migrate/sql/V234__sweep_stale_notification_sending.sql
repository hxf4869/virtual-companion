-- W16 review: recover sending rows whose channel send outlived the
-- caller's bound. Each row is abandoned as unknown for its own owner.
-- A younger sending row, and every non-sending row, is left as it is.
-- The bound is the channel send timeout plus margin, chosen by the caller
-- (jobs.NotificationSendingSweepAge). The decision code returned by
-- abandon_notification_sending is NOTIFICATION_SENDING_UNKNOWN.

SET search_path TO vc, pg_catalog;

CREATE FUNCTION vc.sweep_stale_notification_sending(p_older_than_seconds integer)
    RETURNS integer
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_owner bigint;
    v_id bigint;
    v_code text;
    v_count integer := 0;
BEGIN
    IF p_older_than_seconds IS NULL OR p_older_than_seconds < 1 THEN
        RAISE EXCEPTION 'sweep_stale_notification_sending: p_older_than_seconds must be positive';
    END IF;
    FOR v_owner, v_id IN
        SELECT d.owner_user_id, d.id
          FROM vc.notification_delivery d
         WHERE d.status = 'sending'
           AND d.updated_at <= clock_timestamp() - make_interval(secs => p_older_than_seconds)
         ORDER BY d.owner_user_id, d.id
         FOR UPDATE
    LOOP
        v_code := vc.abandon_notification_sending(v_owner, v_id, p_older_than_seconds);
        IF v_code IS NOT NULL THEN
            v_count := v_count + 1;
        END IF;
    END LOOP;
    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION vc.sweep_stale_notification_sending(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.sweep_stale_notification_sending(integer) TO vc_api, vc_worker;
