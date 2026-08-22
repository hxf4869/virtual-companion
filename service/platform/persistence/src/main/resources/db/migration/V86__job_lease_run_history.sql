-- S0-31-B: named job lease + run history. Two runtimes cannot both purge;
-- pause/dry-run are fail-closed flags (Owner flips them). Runtime roles never
-- take table DML. Run rows store category counts only — never chat body.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.job_lease (
    job_name    text PRIMARY KEY,
    holder      text,
    fence       text,
    expires_at  timestamptz,
    paused      boolean NOT NULL DEFAULT false,
    dry_run     boolean NOT NULL DEFAULT false,
    CONSTRAINT job_lease_name CHECK (job_name IN (
        'RETENTION_PURGE', 'AUTH_EVENT_PURGE', 'DAU_METRICS', 'EXPORT_EXPIRY')),
    CONSTRAINT job_lease_holder CHECK (holder IS NULL OR char_length(holder) BETWEEN 1 AND 64)
);

CREATE SEQUENCE IF NOT EXISTS vc.job_run_id_seq AS bigint;

CREATE TABLE vc.job_run (
    id               bigint PRIMARY KEY DEFAULT nextval('vc.job_run_id_seq'),
    job_name         text NOT NULL,
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    status           text NOT NULL,
    category_counts  jsonb NOT NULL DEFAULT '{}'::jsonb,
    last_error       text,
    CONSTRAINT job_run_name CHECK (job_name IN (
        'RETENTION_PURGE', 'AUTH_EVENT_PURGE', 'DAU_METRICS', 'EXPORT_EXPIRY')),
    CONSTRAINT job_run_status CHECK (status IN (
        'STARTED', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'DRY_RUN')),
    CONSTRAINT job_run_error CHECK (last_error IS NULL OR char_length(last_error) <= 120)
);

INSERT INTO vc.job_lease(job_name) VALUES
    ('RETENTION_PURGE'),
    ('AUTH_EVENT_PURGE'),
    ('DAU_METRICS'),
    ('EXPORT_EXPIRY');

REVOKE ALL ON vc.job_lease, vc.job_run FROM PUBLIC;
REVOKE ALL ON SEQUENCE vc.job_run_id_seq FROM PUBLIC;
GRANT SELECT ON vc.job_lease, vc.job_run
    TO vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.try_acquire_job_lease(
    p_job_name       text,
    p_holder         text,
    p_lease_seconds  integer
)
    RETURNS TABLE(out_acquired boolean, out_paused boolean, out_dry_run boolean)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_row vc.job_lease%ROWTYPE;
    v_holder text;
    v_lease integer;
BEGIN
    IF p_job_name IS NULL OR p_job_name NOT IN (
            'RETENTION_PURGE', 'AUTH_EVENT_PURGE', 'DAU_METRICS', 'EXPORT_EXPIRY') THEN
        RAISE EXCEPTION 'try_acquire_job_lease: unsupported job';
    END IF;
    v_holder := btrim(p_holder);
    IF v_holder IS NULL OR v_holder = '' OR char_length(v_holder) > 64 THEN
        RAISE EXCEPTION 'try_acquire_job_lease: holder is required';
    END IF;
    v_lease := GREATEST(COALESCE(p_lease_seconds, 1), 1);

    SELECT * INTO v_row
      FROM vc.job_lease
     WHERE job_name = p_job_name
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'try_acquire_job_lease: job row missing';
    END IF;
    IF v_row.paused THEN
        RETURN QUERY SELECT false, true, v_row.dry_run;
        RETURN;
    END IF;
    IF v_row.expires_at IS NOT NULL
       AND v_row.expires_at > now()
       AND v_row.holder IS DISTINCT FROM v_holder THEN
        RETURN QUERY SELECT false, false, v_row.dry_run;
        RETURN;
    END IF;

    UPDATE vc.job_lease
       SET holder = v_holder,
           fence = gen_random_uuid()::text,
           expires_at = now() + make_interval(secs => v_lease)
     WHERE job_name = p_job_name;

    RETURN QUERY SELECT true, false, v_row.dry_run;
END;
$$;

CREATE FUNCTION vc.start_job_run(p_job_name text)
    RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_id bigint;
BEGIN
    IF p_job_name IS NULL OR p_job_name NOT IN (
            'RETENTION_PURGE', 'AUTH_EVENT_PURGE', 'DAU_METRICS', 'EXPORT_EXPIRY') THEN
        RAISE EXCEPTION 'start_job_run: unsupported job';
    END IF;
    INSERT INTO vc.job_run(job_name, status)
    VALUES (p_job_name, 'STARTED')
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE FUNCTION vc.finish_job_run(
    p_id      bigint,
    p_status  text,
    p_counts  jsonb,
    p_error   text
)
    RETURNS boolean
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
BEGIN
    IF p_id IS NULL OR p_id <= 0 THEN
        RAISE EXCEPTION 'finish_job_run: id is required';
    END IF;
    IF p_status IS NULL OR p_status NOT IN ('SUCCEEDED', 'FAILED', 'SKIPPED', 'DRY_RUN') THEN
        RAISE EXCEPTION 'finish_job_run: unsupported status';
    END IF;
    UPDATE vc.job_run
       SET finished_at = now(),
           status = p_status,
           category_counts = COALESCE(p_counts, '{}'::jsonb),
           last_error = NULLIF(left(btrim(COALESCE(p_error, '')), 120), '')
     WHERE id = p_id AND status = 'STARTED';
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION vc.try_acquire_job_lease(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.start_job_run(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.finish_job_run(bigint, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.try_acquire_job_lease(text, text, integer)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.start_job_run(text)
    TO vc_api, vc_worker, vc_job_coordinator;
GRANT EXECUTE ON FUNCTION vc.finish_job_run(bigint, text, jsonb, text)
    TO vc_api, vc_worker, vc_job_coordinator;
