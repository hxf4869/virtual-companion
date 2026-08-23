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
        // The persistence module jar ships db/migration/V1..V41 on the test
        // classpath, mirroring the runtime deployment (V26 = TASK-0181
        // create_authorization_snapshots; V27 = TASK-0191 owner-context
        // cryptographic binding; V28 = TASK-0194 worker lease/fence business
        // guard; V29 = RETRY-A bounded retry + dead-letter; V30 = CONV-HIST
        // list_conversations; V31 = ADMIN-ACCTS account list/disable + betaGate
        // capacity; V32 = CONV-MGMT delete/rename + list title; V33 =
        // GEN-RECONC idempotent promote + stale-intent closure + reconcile;
        // V34 = CHAT-MODE generation.mode + receive_generation p_mode;
        // V35 = FEEDBACK generation_feedback + record_generation_feedback;
        // V36 = ADMIN-OPS identity_auth_event_list + admin_usage_summary;
        // V37 = MSG-DELETE delete_message; V38 = INC-MODE conversation.incognito;
        // V39 = REMINDER structured reminders; V40 = ENT-SNAP entitlement
        // assignment + minted per-generation snapshots; V41 = CONSENT
        // versioned consent records; V42 = DATA-EXPORT asynchronous user data
        // export; V43 = ACCT-DELETE self-service account deletion;
        // V44 = MEM-NEG message no_memory negative marker;
        // V45 = AGE-MIN adult-verification result persistence;
        // V46 = AUTH-RECHECK consent withdrawal withdraws snapshots;
        // V47 = COMP-CFG structured Companion preferences;
        // V48 = COMP-PRES gender presentation + curated avatar reference;
        // V49 = COMP-CLEAR relationship reset/delete + clearance preview;
        // V50 = END-TODAY end conversation + incognito body clear;
        // V51 = CHAT-MODE CASUAL turn mode;
        // V52 = USAGE-HEALTH continuous-use reminder prefs + heartbeat;
        // V53 = GEN-VER generation versions for one user message;
        // V54 = INC-PREF default incognito for the next new conversation;
        // V55 = MEM-IMPORT explicit archive/import of confirmed memories;
        // V56 = REPORT-BE/AGE-APPEAL report intake + age-appeal tables;
        // V57 = CHAT-WIPE account-wide chat wipe + MEM-SUPPRESS;
        // V58 = SAFETY-WIRE safety events + input-block catalog edges;
        // V59 = SAFETY-QUEUE admin safety queue read;
        // V60 = INVITE invite codes + SVC-WINDOW beta window state;
        // V61 = ENT-TRIAL trial grants + QUOTA-PERSIST reconciliation;
        // V62 = EMBED-RECALL memory embeddings + DEGRADED-AI actual class;
        // V63 = CONV-SUMMARY L2 conversation summaries;
        // V64 = ADMIN-BETA console queues;
        // V65 = EMERGENCY-CONTACT lifecycle;
        // V66 = MEM-AUTO-SAVE deterministic low-sensitivity auto-save;
        // V67 = drill-fix explicit row emission for two set-returning SDs;
        // V68 = MEM-SUPERSEDE/MEM-EVENT explicit supersede chain + event
        // lifecycle with lazy EXPIRED);
        // V69 = METRICS-ALERT safety-queue SLA age (list_safety_events
        // redefinition adds out_age_hours);
        // V70 = RETENTION versioned data_retention_policy + categorized
        // purge SDs);
        // V72 = B1-SURVEY daily 被理解感 score capture (survey_response RLS table);
        // V73/V74/V75 = review-fix bundles (anchor FK column lists, RLS/REVOKE
        // hardening + indexes, SD function guards);
        // V76 = export download-token hashed at rest (issue-once semantics);
        // V77 = METRICS-ALERT job_daily_active_users (vc_beta_dau gauge source).
        // V78 = S0-17-B crypto key id/version checkpoint re-encrypt;
        // V79 = S0-32 conversation summary at-rest cipher;
        // V80 = S0-04 generation admission gate tables;
        // V81 = S0-11-B immutable route decision audit;
        // V82 = S0-11-C shared non-monetary quota book;
        // V83 = S0-29 model cost budget (reserved spend ceiling);
        // V84 = S0-30 session epoch + sensitive-route admission;
        // V85 = S0-31-A alert webhook outbox + HMAC + host allowlist;
        // V86 = S0-31-B scheduler lease + run history;
        // V87 = S0-24-A staged release gate;
        // V88/V89/V90/V91 = S0-14 ops_case state machine + RBAC + actions + list;
        // V92 = S0-15 refresh session family registry + password change;
        // V93 = review-fix: advance_release_gate + ops_case_event grants
        // pulled back from runtime roles.
        assertThat(SchemaReadinessHealthIndicator.expectedSchemaVersionFromClasspath())
                .isEqualTo(93);
    }
}
