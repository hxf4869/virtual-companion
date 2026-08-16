package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.Status;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * P1-11 schema readiness gate matrix. All database interaction is mocked, so
 * the gate's fail-closed decision logic is verified without a live database:
 * UP only when every marker and (when in-app Flyway is enabled) the schema
 * history agree; DOWN for an empty schema, a behind version, failed migration
 * rows, missing runtime roles and any query failure.
 */
class SchemaReadinessHealthIndicatorTest {

    private final JdbcTemplate runtimeJdbc = mock(JdbcTemplate.class);
    private final JdbcTemplate migratorJdbc = mock(JdbcTemplate.class);

    private Health health(int functionCount, int roleCount) {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(functionCount, roleCount);
        return new SchemaReadinessHealthIndicator(runtimeJdbc, migratorJdbc, 17).health();
    }

    @Test
    void upWhenFunctionsRolesAndSchemaHistoryAgree() {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(2, 4);
        when(migratorJdbc.queryForObject(
                        eq("SELECT to_regclass('flyway_schema_history')::text"), eq(String.class)))
                .thenReturn("public.flyway_schema_history");
        when(migratorJdbc.queryForObject(anyString(), eq(Integer.class), any()))
                .thenReturn(1);
        when(migratorJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(0);

        Health health = new SchemaReadinessHealthIndicator(runtimeJdbc, migratorJdbc, 17).health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
        assertThat(health.getDetails()).containsEntry("schemaVersion", 17);
    }

    @Test
    void downOnEmptySchemaMissingFunctions() {
        Health health = health(0, 0);
        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).extractingByKey("reason").asString()
                .contains("required SD functions missing");
    }

    @Test
    void downWhenRuntimeRolesMissing() {
        Health health = health(2, 3);
        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).extractingByKey("reason").asString()
                .contains("runtime roles missing");
    }

    @Test
    void downWhenSchemaHistoryTableMissing() {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(2, 4);
        when(migratorJdbc.queryForObject(
                        eq("SELECT to_regclass('flyway_schema_history')::text"), eq(String.class)))
                .thenReturn(null);

        Health health = new SchemaReadinessHealthIndicator(runtimeJdbc, migratorJdbc, 17).health();

        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).extractingByKey("reason").asString()
                .contains("schema history missing");
    }

    @Test
    void downWhenSchemaVersionBehind() {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(2, 4);
        when(migratorJdbc.queryForObject(
                        eq("SELECT to_regclass('flyway_schema_history')::text"), eq(String.class)))
                .thenReturn("public.flyway_schema_history");
        // Version 16 applied but 17 expected -> no successful row for '17'.
        when(migratorJdbc.queryForObject(anyString(), eq(Integer.class), any()))
                .thenReturn(0);

        Health health = new SchemaReadinessHealthIndicator(runtimeJdbc, migratorJdbc, 17).health();

        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).extractingByKey("reason").asString()
                .contains("schema version behind: expected 17");
    }

    @Test
    void downWhenFailedMigrationRowsPresent() {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(2, 4);
        when(migratorJdbc.queryForObject(
                        eq("SELECT to_regclass('flyway_schema_history')::text"), eq(String.class)))
                .thenReturn("public.flyway_schema_history");
        when(migratorJdbc.queryForObject(anyString(), eq(Integer.class), any()))
                .thenReturn(1);
        when(migratorJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(1);

        Health health = new SchemaReadinessHealthIndicator(runtimeJdbc, migratorJdbc, 17).health();

        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
        assertThat(health.getDetails()).extractingByKey("reason").asString()
                .contains("failed migration rows");
    }

    @Test
    void downWhenRuntimeQueryFails() {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenThrow(new BadSqlGrammarException("task", "SELECT 1",
                        new java.sql.SQLException("connection problem", "08001")));

        Health health = new SchemaReadinessHealthIndicator(runtimeJdbc, migratorJdbc, 17).health();

        assertThat(health.getStatus()).isEqualTo(Status.DOWN);
    }

    @Test
    void markerOnlyModeWithoutMigratorChecksStillGatesOnMarkers() {
        when(runtimeJdbc.queryForObject(anyString(), eq(Integer.class)))
                .thenReturn(2, 4);

        Health health = new SchemaReadinessHealthIndicator(runtimeJdbc, null, 17).health();

        assertThat(health.getStatus()).isEqualTo(Status.UP);
    }

    @Test
    void expectedSchemaVersionFromClasspathFindsNewestMigration() {
        // The persistence module jar ships db/migration/V1..V33 on the test
        // classpath, mirroring the runtime deployment (V26 = TASK-0181
        // create_authorization_snapshots; V27 = TASK-0191 owner-context
        // cryptographic binding; V28 = TASK-0194 worker lease/fence business
        // guard; V29 = RETRY-A bounded retry + dead-letter; V30 = CONV-HIST
        // list_conversations; V31 = ADMIN-ACCTS account list/disable + betaGate
        // capacity; V32 = CONV-MGMT delete/rename + list title; V33 =
        // GEN-RECONC idempotent promote + stale-intent closure + reconcile).
        assertThat(SchemaReadinessHealthIndicator.expectedSchemaVersionFromClasspath())
                .isEqualTo(33);
    }
}
