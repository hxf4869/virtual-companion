-- W16 review: a delivery that has passed the send checks is marked sending
-- under the row lock before the channel is called. Withdrawal still stops
-- only pending rows, so it waits on that same lock. record and schedule
-- accept sending: record writes the terminal outcome, and schedule puts a
-- bounded retry back to pending.

SET search_path TO vc, pg_catalog;

ALTER TABLE vc.notification_delivery DROP CONSTRAINT notification_delivery_status;
ALTER TABLE vc.notification_delivery ADD CONSTRAINT notification_delivery_status CHECK (
    status IN ('pending', 'sending', 'accepted', 'failed', 'unknown', 'stopped'));

ALTER TABLE vc.notification_delivery DROP CONSTRAINT notification_delivery_pending_shape;
ALTER TABLE vc.notification_delivery ADD CONSTRAINT notification_delivery_pending_shape CHECK (
    status NOT IN ('pending', 'sending')
    OR (failure_code IS NULL AND correlation_id IS NULL AND stopped_reason IS NULL));

CREATE OR REPLACE FUNCTION vc.record_notification_delivery_outcome(
    p_owner bigint,
    p_delivery_id bigint,
    p_outcome text,
    p_failure_code text,
    p_correlation text)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_outcome text := NULLIF(btrim(p_outcome), '');
    v_failure text := NULLIF(btrim(p_failure_code), '');
    v_corr text := NULLIF(btrim(p_correlation), '');
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF v_outcome IS NULL OR v_outcome NOT IN ('accepted', 'failed', 'unknown') THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    SELECT d.status INTO v_status
      FROM vc.notification_delivery d
     WHERE d.owner_user_id = p_owner AND d.id = p_delivery_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    IF v_status = v_outcome THEN
        RETURN v_status;
    END IF;
    IF (v_status = 'unknown' AND v_outcome = 'failed')
       OR (v_status = 'failed' AND v_outcome = 'unknown') THEN
        RAISE EXCEPTION 'notification delivery: unknown and failed cannot be mixed';
    END IF;
    IF v_status NOT IN ('pending', 'sending') THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    IF v_outcome = 'unknown' AND v_failure IS NOT NULL THEN
        RAISE EXCEPTION 'notification delivery: unknown and failed cannot be mixed';
    END IF;
    IF v_outcome = 'failed' AND (v_failure IS NULL OR v_failure !~ '^[A-Z0-9_]{1,64}$') THEN
        RAISE EXCEPTION 'notification delivery: failed requires a failure code';
    END IF;
    IF v_outcome = 'accepted' AND (v_corr IS NULL OR v_corr !~ '^[A-Za-z0-9_.:-]{1,128}$') THEN
        RAISE EXCEPTION 'notification delivery: accepted requires a correlation id';
    END IF;
    IF v_outcome = 'accepted' AND v_failure IS NOT NULL THEN
        RAISE EXCEPTION 'notification delivery: accepted cannot be failed';
    END IF;
    IF v_outcome <> 'failed' THEN
        v_failure := NULL;
    END IF;
    IF v_corr IS NOT NULL AND v_corr !~ '^[A-Za-z0-9_.:-]{1,128}$' THEN
        v_corr := NULL;
    END IF;
    UPDATE vc.notification_delivery
       SET status = v_outcome,
           failure_code = v_failure,
           correlation_id = v_corr,
           attempt_count = attempt_count + 1,
           next_attempt_at = NULL,
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner AND id = p_delivery_id;
    RETURN v_outcome;
END;
$$;

CREATE OR REPLACE FUNCTION vc.schedule_notification_delivery(
    p_owner bigint,
    p_delivery_id bigint,
    p_attempt_count integer,
    p_next_attempt_at timestamptz)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
    v_attempts integer;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    IF p_attempt_count IS NULL OR p_attempt_count < 0 OR p_next_attempt_at IS NULL THEN
        RAISE EXCEPTION 'notification delivery: schedule is invalid';
    END IF;
    SELECT d.status, d.attempt_count INTO v_status, v_attempts
      FROM vc.notification_delivery d
     WHERE d.owner_user_id = p_owner AND d.id = p_delivery_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification delivery not found';
    END IF;
    IF v_status NOT IN ('pending', 'sending') THEN
        RAISE EXCEPTION 'notification delivery: outcome is already terminal';
    END IF;
    IF p_attempt_count < v_attempts THEN
        RAISE EXCEPTION 'notification delivery: schedule is invalid';
    END IF;
    UPDATE vc.notification_delivery
       SET status = 'pending',
           attempt_count = p_attempt_count,
           next_attempt_at = p_next_attempt_at,
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner AND id = p_delivery_id;
END;
$$;

CREATE FUNCTION vc.lock_notification_delivery(p_owner bigint, p_id bigint)
    RETURNS text
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_status text;
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    SELECT d.status INTO v_status
      FROM vc.notification_delivery d
     WHERE d.owner_user_id = p_owner AND d.id = p_id
     FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'notification delivery not found';
    END IF;
    RETURN v_status;
END;
$$;

CREATE FUNCTION vc.mark_notification_delivery_sending(p_owner bigint, p_id bigint)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    PERFORM vc.go_assert_owner(p_owner);
    UPDATE vc.notification_delivery
       SET status = 'sending',
           updated_at = clock_timestamp()
     WHERE owner_user_id = p_owner AND id = p_id AND status = 'pending';
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vc.lock_notification_delivery(bigint, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.mark_notification_delivery_sending(bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.lock_notification_delivery(bigint, bigint) TO vc_api, vc_worker;
GRANT EXECUTE ON FUNCTION vc.mark_notification_delivery_sending(bigint, bigint) TO vc_api, vc_worker;
