-- Owner rerank switch: vc_api cannot read the table, only an active ADMIN
-- can read or change their own row, and another owner cannot see it.
-- A missing row stays enabled at revision 0. Deployment disable is not stored here.

\set ON_ERROR_STOP on

INSERT INTO vc.vc_user(id, display_name) VALUES
    (29601, 'r296 admin'), (29602, 'r296 other'), (29603, 'r296 user'), (29604, 'r296 disabled')
ON CONFLICT (id) DO NOTHING;
INSERT INTO vc.identity_account(id, username, password_hash, role, status, display_name) VALUES
    (29601, 'r296-admin', 'synthetic', 'ADMIN', 'ACTIVE', 'admin'),
    (29602, 'r296-other', 'synthetic', 'ADMIN', 'ACTIVE', 'other'),
    (29603, 'r296-user', 'synthetic', 'USER', 'ACTIVE', 'user'),
    (29604, 'r296-disabled', 'synthetic', 'ADMIN', 'DISABLED', 'disabled')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status;

DELETE FROM vc.owner_memory_rerank WHERE owner_user_id IN (29601, 29602, 29603, 29604);

DO $$
DECLARE flags boolean;
BEGIN
    SELECT c.relrowsecurity AND c.relforcerowsecurity INTO flags
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'vc' AND c.relname = 'owner_memory_rerank';
    IF flags IS NOT TRUE THEN RAISE EXCEPTION 'owner_memory_rerank RLS is not forced'; END IF;
END $$;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM 1 FROM vc.owner_memory_rerank;
    RAISE EXCEPTION 'vc_api read owner_memory_rerank';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
DO $$
BEGIN
    INSERT INTO vc.owner_memory_rerank(owner_user_id, enabled, revision) VALUES (29601, false, 1);
    RAISE EXCEPTION 'vc_api wrote owner_memory_rerank';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_worker;
DO $$
BEGIN
    PERFORM vc.go_admin_get_owner_memory_rerank(29601);
    RAISE EXCEPTION 'worker read rerank';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
DO $$
BEGIN
    PERFORM vc.go_service_resolve_owner_memory_rerank(29601);
    RAISE EXCEPTION 'worker resolved rerank';
EXCEPTION WHEN insufficient_privilege THEN
    NULL;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM 1 FROM vc.go_admin_get_owner_memory_rerank(29603);
    RAISE EXCEPTION 'user read rerank';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%user read rerank%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
        RAISE EXCEPTION 'user denial %', SQLERRM;
    END IF;
END $$;
DO $$
BEGIN
    PERFORM 1 FROM vc.go_admin_save_owner_memory_rerank(29603, false, 0);
    RAISE EXCEPTION 'user saved rerank';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%user saved rerank%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not an active ADMIN%' THEN
        RAISE EXCEPTION 'user save denial %', SQLERRM;
    END IF;
END $$;
DO $$
DECLARE
    v_enabled boolean;
    v_revision bigint;
BEGIN
    SELECT out_enabled, out_revision INTO v_enabled, v_revision
      FROM vc.go_admin_get_owner_memory_rerank(29601);
    IF v_enabled IS NOT TRUE OR v_revision IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'default % %', v_enabled, v_revision;
    END IF;
    SELECT out_enabled, out_revision INTO v_enabled, v_revision
      FROM vc.go_admin_save_owner_memory_rerank(29601, false, 0);
    IF v_enabled IS NOT FALSE OR v_revision IS DISTINCT FROM 1 THEN
        RAISE EXCEPTION 'saved % %', v_enabled, v_revision;
    END IF;
    BEGIN
        PERFORM vc.go_admin_save_owner_memory_rerank(29601, true, 0);
        RAISE EXCEPTION 'stale revision accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%stale revision accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%revision conflict (current 1)%' THEN
            RAISE EXCEPTION 'stale denial %', SQLERRM;
        END IF;
    END;
    SELECT out_enabled, out_revision INTO v_enabled, v_revision
      FROM vc.go_admin_get_owner_memory_rerank(29602);
    IF v_enabled IS NOT TRUE OR v_revision IS DISTINCT FROM 0 THEN
        RAISE EXCEPTION 'other owner saw % %', v_enabled, v_revision;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.go_service_resolve_owner_memory_rerank(29601);
    RAISE EXCEPTION 'unbound resolve accepted';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%unbound resolve accepted%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%does not match server-trusted current_owner_id%' THEN
        RAISE EXCEPTION 'unbound denial %', SQLERRM;
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(29601, 'r296a', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|29601|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|r296a',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF vc.go_service_resolve_owner_memory_rerank(29601) IS NOT FALSE THEN
        RAISE EXCEPTION 'resolve ignored the saved switch';
    END IF;
    BEGIN
        PERFORM vc.go_service_resolve_owner_memory_rerank(29602);
        RAISE EXCEPTION 'cross owner resolve accepted';
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM LIKE '%cross owner resolve accepted%' THEN RAISE; END IF;
        IF SQLERRM NOT LIKE '%does not match server-trusted current_owner_id%' THEN
            RAISE EXCEPTION 'cross owner denial %', SQLERRM;
        END IF;
    END;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(29602, 'r296b', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|29602|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|r296b',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF vc.go_service_resolve_owner_memory_rerank(29602) IS NOT TRUE THEN
        RAISE EXCEPTION 'other owner resolve was not the default';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(29603, 'r296c', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|29603|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|r296c',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    IF vc.go_service_resolve_owner_memory_rerank(29603) IS NOT TRUE THEN
        RAISE EXCEPTION 'active user resolve was not the default';
    END IF;
END $$;
COMMIT;
RESET ROLE;

BEGIN;
SELECT vc.set_owner_context(29604, 'r296d', encode(vc.hmac(convert_to(
    'vc-owner-binding-v1|29604|' || pg_backend_pid() || '|' || pg_current_xact_id() || '|r296d',
    'UTF8'), convert_to((SELECT secret FROM vc._owner_binding_secret WHERE id = 1), 'UTF8'), 'sha256'), 'hex'));
SET LOCAL ROLE vc_api;
DO $$
BEGIN
    PERFORM vc.go_service_resolve_owner_memory_rerank(29604);
    RAISE EXCEPTION 'disabled owner resolved';
EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%disabled owner resolved%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '%not an active account%' THEN
        RAISE EXCEPTION 'disabled denial %', SQLERRM;
    END IF;
END $$;
COMMIT;
RESET ROLE;
