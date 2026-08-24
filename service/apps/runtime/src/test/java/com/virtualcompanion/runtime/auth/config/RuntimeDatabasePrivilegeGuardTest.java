package com.virtualcompanion.runtime.auth.config;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class RuntimeDatabasePrivilegeGuardTest {

    @Test
    void acceptsOnlyTheCompositeNoDdlNoBypassRuntimeLogin() {
        assertDoesNotThrow(() -> RuntimeDatabasePrivilegeGuard.verify(valid()));
    }

    @Test
    void rejectsSuperuserMigratorSchemaCreateAndMissingMembership() {
        for (String flag : new String[] {
                "superuser", "bypass_rls", "create_db", "create_role", "schema_create"}) {
            Map<String, Object> row = valid();
            row.put(flag, true);
            assertThrows(IllegalStateException.class,
                    () -> RuntimeDatabasePrivilegeGuard.verify(row));
        }
        Map<String, Object> missing = valid();
        missing.put("worker_member", false);
        assertThrows(IllegalStateException.class,
                () -> RuntimeDatabasePrivilegeGuard.verify(missing));
        Map<String, Object> migrator = valid();
        migrator.put("role_name", "vc_migrator");
        assertThrows(IllegalStateException.class,
                () -> RuntimeDatabasePrivilegeGuard.verify(migrator));
    }

    @Test
    void flywayGuardRejectsTheSameRuntimeAndMigratorPrincipal() {
        AuthDataSourceConfig config = new AuthDataSourceConfig();
        assertThrows(IllegalStateException.class, () ->
                config.flywayMigratorCredentialsGuard(
                        "jdbc:postgresql://db/vc", "vc_migrator", "secret", "vc_migrator"));
        assertDoesNotThrow(() -> config.flywayMigratorCredentialsGuard(
                "jdbc:postgresql://db/vc", "vc_migrator", "secret", "vc_runtime_login"));
    }

    private static Map<String, Object> valid() {
        Map<String, Object> row = new HashMap<>();
        row.put("role_name", "vc_runtime_login");
        row.put("superuser", false);
        row.put("bypass_rls", false);
        row.put("create_db", false);
        row.put("create_role", false);
        row.put("schema_create", false);
        row.put("api_member", true);
        row.put("worker_member", true);
        row.put("job_member", true);
        row.put("dispatcher_member", true);
        return row;
    }
}
