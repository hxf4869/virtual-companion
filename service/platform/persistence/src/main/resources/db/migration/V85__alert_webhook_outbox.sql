-- S0-31-A: durable alert webhook outbox. Runtime roles never take table DML;
-- enqueue/claim/complete go through SECURITY DEFINER. Dedup is (code, window).
-- Payload is catalog severity/code plus a short operator message — never chat
-- body, tokens, or contact details. Host allowlist and HMAC stay in the app.

SET search_path TO vc, pg_catalog;

CREATE SEQUENCE IF NOT EXISTS vc.alert_webhook_outbox_id_seq AS bigint;

CREATE TABLE vc.alert_webhook_outbox (
    id              bigint PRIMARY KEY DEFAULT nextval('vc.alert_webhook_outbox_id_seq'),
    severity        text NOT NULL,
    code            text NOT NULL,
    message         text NOT NULL,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    window_start    timestamptz NOT NULL,
    status          text NOT NULL DEFAULT 'PENDING',
    attempt_count   integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    last_error      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT alert_webhook_outbox_severity CHECK (severity IN ('P0', 'P1', 'P2')),
    CONSTRAINT alert_webhook_outbox_status CHECK (
        status IN ('PENDING', 'IN_FLIGHT', 'DELIVERED', 'DEAD')),
    CONSTRAINT alert_webhook_outbox_code CHECK (char_length(code) BETWEEN 1 AND 64),
    CONSTRAINT alert_webhook_outbox_message CHECK (char_length(message) BETWEEN 1 AND 240),
    CONSTRAINT alert_webhook_outbox_attempts CHECK (attempt_count >= 0),
    CONSTRAINT alert_webhook_outbox_dedup UNIQUE (code, window_start)
);

REVOKE ALL ON vc.alert_webhook_outbox FROM PUBLIC;
REVOKE ALL ON SEQUENCE vc.alert_webhook_outbox_id_seq FROM PUBLIC;
GRANT SELECT ON vc.alert_webhook_outbox
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.enqueue_alert_webhook(
    p_severity        text,
    p_code            text,
    p_message         text,
    p_window_seconds  integer
)
    RETURNS TABLE(out_id bigint, out_inserted boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_window timestamptz;
    v_id bigint;
    v_code text;
    v_message text;
BEGIN
    IF p_severity IS NULL OR p_severity NOT IN ('P0', 'P1', 'P2') THEN
        RAISE EXCEPTION 'enqueue_alert_webhook: unsupported severity';
    END IF;
    v_code := btrim(p_code);
    IF v_code IS NULL OR v_code = '' OR char_length(v_code) > 64 THEN
        RAISE EXCEPTION 'enqueue_alert_webhook: code is required';
    END IF;
    v_message := left(btrim(COALESCE(p_message, '')), 240);
    IF v_message IS NULL OR v_message = '' THEN
        RAISE EXCEPTION 'enqueue_alert_webhook: message is required';
    END IF;
    IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
        RAISE EXCEPTION 'enqueue_alert_webhook: window must be positive';
    END IF;

    v_window := to_timestamp(
        floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds);

    INSERT INTO vc.alert_webhook_outbox(
            severity, code, message, occurred_at, window_start, status)
    VALUES (p_severity, v_code, v_message, now(), v_window, 'PENDING')
    ON CONFLICT (code, window_start) DO NOTHING
    RETURNING id INTO v_id;

    IF v_id IS NULL THEN
        SELECT o.id INTO v_id
          FROM vc.alert_webhook_outbox o
         WHERE o.code = v_code AND o.window_start = v_window;
        RETURN QUERY SELECT v_id, false;
    ELSE
        RETURN QUERY SELECT v_id, true;
    END IF;
END;
$$;

CREATE FUNCTION vc.claim_alert_webhook(p_limit integer)
    RETURNS TABLE(
        out_id bigint,
        out_severity text,
        out_code text,
        out_message text,
        out_occurred_at timestamptz,
        out_attempt_count integer)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit integer;
BEGIN
    v_limit := LEAST(GREATEST(COALESCE(p_limit, 1), 1), 32);
    RETURN QUERY
    WITH picked AS (
        SELECT o.id
          FROM vc.alert_webhook_outbox o
         WHERE o.status IN ('PENDING', 'IN_FLIGHT')
           AND o.next_attempt_at <= now()
         ORDER BY o.id
         FOR UPDATE OF o SKIP LOCKED
         LIMIT v_limit
    )
    UPDATE vc.alert_webhook_outbox u
       SET status = 'IN_FLIGHT',
           attempt_count = u.attempt_count + 1,
           next_attempt_at = now() + interval '30 seconds'
      FROM picked
     WHERE u.id = picked.id
    RETURNING u.id, u.severity, u.code, u.message, u.occurred_at, u.attempt_count;
END;
$$;

CREATE FUNCTION vc.complete_alert_webhook(
    p_id            bigint,
    p_outcome       text,
    p_error         text,
    p_max_attempts  integer,
    p_backoff_seconds integer
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_attempts integer;
    v_max integer;
    v_backoff integer;
    v_error text;
BEGIN
    IF p_id IS NULL OR p_id <= 0 THEN
        RAISE EXCEPTION 'complete_alert_webhook: id is required';
    END IF;
    IF p_outcome IS NULL OR p_outcome NOT IN ('DELIVERED', 'RETRY', 'DEAD') THEN
        RAISE EXCEPTION 'complete_alert_webhook: unsupported outcome';
    END IF;
    v_max := GREATEST(COALESCE(p_max_attempts, 1), 1);
    v_backoff := GREATEST(COALESCE(p_backoff_seconds, 1), 1);
    v_error := left(btrim(COALESCE(p_error, '')), 120);

    SELECT o.attempt_count INTO v_attempts
      FROM vc.alert_webhook_outbox o
     WHERE o.id = p_id AND o.status = 'IN_FLIGHT';
    IF v_attempts IS NULL THEN
        RETURN FALSE;
    END IF;

    IF p_outcome = 'DELIVERED' THEN
        UPDATE vc.alert_webhook_outbox
           SET status = 'DELIVERED',
               last_error = NULL
         WHERE id = p_id AND status = 'IN_FLIGHT';
        RETURN FOUND;
    END IF;

    IF p_outcome = 'DEAD' OR v_attempts >= v_max THEN
        UPDATE vc.alert_webhook_outbox
           SET status = 'DEAD',
               last_error = NULLIF(v_error, '')
         WHERE id = p_id AND status = 'IN_FLIGHT';
        RETURN FOUND;
    END IF;

    UPDATE vc.alert_webhook_outbox
       SET status = 'PENDING',
           last_error = NULLIF(v_error, ''),
           next_attempt_at = now() + make_interval(
               secs => LEAST(3600,
                   v_backoff * ((2 ^ LEAST(v_attempts, 8))::integer)))
     WHERE id = p_id AND status = 'IN_FLIGHT';
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vc.enqueue_alert_webhook(text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.claim_alert_webhook(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.complete_alert_webhook(bigint, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.enqueue_alert_webhook(text, text, text, integer)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.claim_alert_webhook(integer)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.complete_alert_webhook(bigint, text, text, integer, integer)
    TO vc_api, vc_worker, vc_job_coordinator;
