-- ADMIN-BETA V64: read-only Beta console queues (§8.2 管理端).
--
-- Four ADMIN-only SECURITY DEFINER reads for the Beta operations page, all
-- re-verifying the ACTIVE ADMIN inside the SD (V36 pattern) and all strictly
-- read-only — triage and disposition stay human actions outside the API:
--   * admin_list_reports     — the report/complaint intake queue (V56)
--   * admin_list_age_appeals — the age-appeal intake queue (V56)
--   * admin_list_export_tasks— the async data-export task queue (V42)
--   * admin_memory_sampling  — memory-anomaly sampling: non-ACCEPTED or
--                              soft-deleted memory rows (V56 MEM-DELETED
--                              groups / REJECTED / EXPIRED), newest first.
-- All cross owner isolation on purpose (the console is cross-tenant);
-- existence of foreign rows is never disclosed to non-admins (fail closed).

SET search_path TO vc, pg_catalog;

-- ---------------------------------------------------------------------------
-- admin_list_reports
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_list_reports(
    p_admin_account_id bigint,
    p_after            bigint DEFAULT NULL,
    p_limit            int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_message_id bigint,
                  out_reason text, out_note text, out_status text,
                  out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_list_reports: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_list_reports: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT r.id, r.owner_user_id, r.message_id, r.reason, r.note, r.status,
           r.created_at
      FROM vc.report_request r
     WHERE (p_after IS NULL OR r.id < p_after)
     ORDER BY r.id DESC
     LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_age_appeals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_list_age_appeals(
    p_admin_account_id bigint,
    p_after            bigint DEFAULT NULL,
    p_limit            int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_reason text,
                  out_status text, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_list_age_appeals: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_list_age_appeals: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT a.id, a.owner_user_id, a.reason, a.status, a.created_at
      FROM vc.age_appeal a
     WHERE (p_after IS NULL OR a.id < p_after)
     ORDER BY a.id DESC
     LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_list_export_tasks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_list_export_tasks(
    p_admin_account_id bigint,
    p_after            bigint DEFAULT NULL,
    p_limit            int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_status text,
                  out_created_at timestamptz, out_completed_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_list_export_tasks: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_list_export_tasks: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT e.id, e.owner_user_id, e.status, e.requested_at, e.completed_at
      FROM vc.export_request e
     WHERE (p_after IS NULL OR e.id < p_after)
     ORDER BY e.id DESC
     LIMIT v_limit;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_memory_sampling: non-ACCEPTED or soft-deleted memory rows (anomaly
-- sampling for the console; content is the memory summary the user already
-- confirmed or explicitly rejected — no message bodies).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION vc.admin_memory_sampling(
    p_admin_account_id bigint,
    p_after            bigint DEFAULT NULL,
    p_limit            int    DEFAULT 50
)
    RETURNS TABLE(out_id bigint, out_owner_user_id bigint, out_relationship_id bigint,
                  out_scope text, out_summary text, out_status text,
                  out_deleted_at timestamptz, out_created_at timestamptz)
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = vc, pg_catalog
AS $$
DECLARE
    v_limit int := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
    IF p_admin_account_id IS NULL OR p_admin_account_id <= 0 THEN
        RAISE EXCEPTION 'admin_memory_sampling: admin account is required';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vc.identity_account
                    WHERE id = p_admin_account_id AND role = 'ADMIN' AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'admin_memory_sampling: caller is not an active ADMIN';
    END IF;

    RETURN QUERY
    SELECT m.id, m.owner_user_id, m.relationship_id, m.scope, m.summary,
           m.status, m.deleted_at, m.created_at
      FROM vc.memory_item m
     WHERE (p_after IS NULL OR m.id < p_after)
       AND (m.status <> 'ACCEPTED' OR m.deleted_at IS NOT NULL)
     ORDER BY m.id DESC
     LIMIT v_limit;
END;
$$;

REVOKE EXECUTE ON FUNCTION vc.admin_list_reports(bigint, bigint, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_list_age_appeals(bigint, bigint, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_list_export_tasks(bigint, bigint, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION vc.admin_memory_sampling(bigint, bigint, int) FROM PUBLIC;

GRANT EXECUTE
    ON FUNCTION vc.admin_list_reports(bigint, bigint, int),
                vc.admin_list_age_appeals(bigint, bigint, int),
                vc.admin_list_export_tasks(bigint, bigint, int),
                vc.admin_memory_sampling(bigint, bigint, int)
    TO vc_api;
