-- Owner-level rerank switch. The extension controls data-memory-enabled and
-- data-memory-budget live in SillyTavern extension settings and are sent on
-- each recall; Go has no row for them. This table is the persistent owner
-- preference. Absence means enabled, revision 0. VC_RERANK_ENABLED=0 on the
-- MemoryCore process still disables rerank regardless of this row.
-- Direct table access stays closed: FORCE RLS, no policy, SECURITY DEFINER only.

SET search_path TO vc, pg_catalog;

CREATE TABLE vc.owner_memory_rerank (
    owner_user_id bigint PRIMARY KEY REFERENCES vc.vc_user(id) ON DELETE CASCADE,
    enabled boolean NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vc.owner_memory_rerank ENABLE ROW LEVEL SECURITY;
ALTER TABLE vc.owner_memory_rerank FORCE ROW LEVEL SECURITY;
REVOKE ALL ON vc.owner_memory_rerank FROM PUBLIC, vc_api, vc_worker, vc_job_coordinator, vc_dispatcher;

CREATE FUNCTION vc.go_admin_get_owner_memory_rerank(p_actor bigint)
RETURNS TABLE (out_enabled boolean, out_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_actor);
    RETURN QUERY
        SELECT COALESCE(r.enabled, true), COALESCE(r.revision, 0)
          FROM (SELECT 1) AS present
          LEFT JOIN vc.owner_memory_rerank r ON r.owner_user_id = p_actor;
END;
$$;

CREATE FUNCTION vc.go_admin_save_owner_memory_rerank(p_actor bigint, p_enabled boolean, p_expected bigint)
RETURNS TABLE (out_enabled boolean, out_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE
    v_revision bigint;
BEGIN
    PERFORM vc.go_admin_assert_provider_actor(p_actor);
    IF p_enabled IS NULL OR p_expected IS NULL OR p_expected < 0 THEN
        RAISE EXCEPTION 'go_admin_provider: invalid rerank setting';
    END IF;
    LOCK TABLE vc.owner_memory_rerank IN EXCLUSIVE MODE;
    SELECT revision INTO v_revision FROM vc.owner_memory_rerank WHERE owner_user_id = p_actor;
    IF p_expected IS DISTINCT FROM COALESCE(v_revision, 0) THEN
        RAISE EXCEPTION 'go_admin_provider: revision conflict (current %)', COALESCE(v_revision, 0);
    END IF;
    INSERT INTO vc.owner_memory_rerank(owner_user_id, enabled, revision)
    VALUES (p_actor, p_enabled, COALESCE(v_revision, 0) + 1)
    ON CONFLICT (owner_user_id) DO UPDATE
        SET enabled = excluded.enabled, revision = excluded.revision, updated_at = now();
    RETURN QUERY
        SELECT r.enabled, r.revision FROM vc.owner_memory_rerank r WHERE r.owner_user_id = p_actor;
END;
$$;

CREATE FUNCTION vc.go_service_resolve_owner_memory_rerank(p_owner bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = vc, pg_catalog AS $$
DECLARE
    v_enabled boolean;
BEGIN
    IF p_owner IS NULL OR p_owner <= 0 OR NOT EXISTS (
        SELECT 1 FROM vc.identity_account WHERE id = p_owner AND status = 'ACTIVE') THEN
        RAISE EXCEPTION 'go_service_purpose: owner is not an active account';
    END IF;
    SELECT enabled INTO v_enabled FROM vc.owner_memory_rerank WHERE owner_user_id = p_owner;
    RETURN COALESCE(v_enabled, true);
END;
$$;

REVOKE ALL ON FUNCTION vc.go_admin_get_owner_memory_rerank(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_admin_save_owner_memory_rerank(bigint, boolean, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION vc.go_service_resolve_owner_memory_rerank(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vc.go_admin_get_owner_memory_rerank(bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_admin_save_owner_memory_rerank(bigint, boolean, bigint) TO vc_api;
GRANT EXECUTE ON FUNCTION vc.go_service_resolve_owner_memory_rerank(bigint) TO vc_api;
