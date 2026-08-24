package com.virtualcompanion.runtime.auth.config;

import java.util.Map;
import java.util.Objects;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.jdbc.core.JdbcTemplate;

/** S0-27 startup proof that the runtime connection is not a migrator/superuser. */
public final class RuntimeDatabasePrivilegeGuard implements InitializingBean {

    static final String PRIVILEGE_SQL = """
            SELECT current_user AS role_name,
                   r.rolsuper AS superuser,
                   r.rolbypassrls AS bypass_rls,
                   r.rolcreatedb AS create_db,
                   r.rolcreaterole AS create_role,
                   has_schema_privilege(current_user, 'vc', 'CREATE') AS schema_create,
                   pg_has_role(current_user, 'vc_api', 'MEMBER') AS api_member,
                   pg_has_role(current_user, 'vc_worker', 'MEMBER') AS worker_member,
                   pg_has_role(current_user, 'vc_job_coordinator', 'MEMBER') AS job_member,
                   pg_has_role(current_user, 'vc_dispatcher', 'MEMBER') AS dispatcher_member
              FROM pg_roles r WHERE r.rolname = current_user
            """;

    private final JdbcTemplate jdbc;

    public RuntimeDatabasePrivilegeGuard(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    @Override
    public void afterPropertiesSet() {
        verify(jdbc.queryForMap(PRIVILEGE_SQL));
    }

    static void verify(Map<String, Object> row) {
        if (row == null || row.isEmpty()) {
            throw new IllegalStateException("runtime database principal could not be inspected");
        }
        if (flag(row, "superuser") || flag(row, "bypass_rls")
                || flag(row, "create_db") || flag(row, "create_role")
                || flag(row, "schema_create")) {
            throw new IllegalStateException(
                    "runtime database principal has migration or RLS-bypass authority");
        }
        for (String membership : new String[] {
                "api_member", "worker_member", "job_member", "dispatcher_member"}) {
            if (!flag(row, membership)) {
                throw new IllegalStateException(
                        "runtime database principal lacks required minimal role membership");
            }
        }
        String roleName = String.valueOf(row.get("role_name"));
        if ("postgres".equalsIgnoreCase(roleName) || "vc_migrator".equalsIgnoreCase(roleName)) {
            throw new IllegalStateException(
                    "runtime database principal must differ from the migrator principal");
        }
    }

    private static boolean flag(Map<String, Object> row, String key) {
        return Boolean.TRUE.equals(row.get(key));
    }
}
