package com.virtualcompanion.runtime.auth.config;

import java.io.IOException;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.boot.health.contributor.Health;
import org.springframework.boot.health.contributor.HealthIndicator;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.util.StringUtils;

/**
 * P1-11 schema readiness gate. Active only when the auth datasource is enabled
 * (see {@link AuthDataSourceConfig}); it verifies that the database actually
 * carries the schema the runtime depends on and fails closed to {@code DOWN}
 * otherwise, so {@code /actuator/health} reports 503 instead of a healthy
 * empty database.
 *
 * <p>Checks, in order (any query failure is {@code DOWN}):
 * <ol>
 *   <li>{@code pg_proc}: the load-bearing SECURITY DEFINER functions
 *       {@code vc.current_owner_id} (V1) and {@code vc.identity_authenticate}
 *       (V14) must each exist exactly once;</li>
 *   <li>{@code pg_roles}: all four runtime roles (vc_api, vc_worker,
 *       vc_job_coordinator, vc_dispatcher) must exist;</li>
 *   <li>when in-app Flyway is enabled (a migrator template is wired from the
 *       Flyway connection), the migrator's {@code flyway_schema_history} table
 *       must exist, the expected version (the newest classpath migration) must
 *       be applied successfully, and there must be no failed migration rows.</li>
 * </ol>
 *
 * <p>The version check deliberately runs through the migrator (Flyway)
 * datasource: runtime roles have no grants on the schema-history table, and
 * schema management is exclusively the migration principal's job. When in-app
 * Flyway is disabled, schema state is operator-managed and only the
 * runtime-visible marker checks apply.
 */
public class SchemaReadinessHealthIndicator implements HealthIndicator {

    static final List<String> REQUIRED_FUNCTIONS =
            List.of("current_owner_id", "identity_authenticate");
    static final List<String> RUNTIME_ROLES =
            List.of("vc_api", "vc_worker", "vc_job_coordinator", "vc_dispatcher");
    private static final String MIGRATION_LOCATION_PATTERN = "classpath*:db/migration/V*.sql";
    private static final Pattern MIGRATION_VERSION_PREFIX = Pattern.compile("^V(\\d+)");

    private final JdbcTemplate runtimeJdbc;
    private final JdbcTemplate migratorJdbc;
    private final int expectedSchemaVersion;

    /**
     * @param runtimeJdbc the runtime (vc_*) datasource template
     * @param migratorJdbc the migration-principal datasource template (the
     *     Flyway connection), or {@code null} when in-app migrations are
     *     disabled
     * @param expectedSchemaVersion the newest migration version on the
     *     classpath (0 when no migrations are present)
     */
    public SchemaReadinessHealthIndicator(
            JdbcTemplate runtimeJdbc, JdbcTemplate migratorJdbc, int expectedSchemaVersion) {
        this.runtimeJdbc = runtimeJdbc;
        this.migratorJdbc = migratorJdbc;
        this.expectedSchemaVersion = expectedSchemaVersion;
    }

    @Override
    public Health health() {
        try {
            checkRequiredFunctions();
            checkRuntimeRoles();
            if (migratorJdbc != null) {
                checkSchemaHistory();
            }
            return Health.up()
                    .withDetail("schemaVersion", expectedSchemaVersion)
                    .withDetail("runtimeRoles", RUNTIME_ROLES.size())
                    .build();
        } catch (RuntimeException ex) {
            return Health.down(ex)
                    .withDetail("reason", schemaUnavailableReason(ex))
                    .build();
        }
    }

    private void checkRequiredFunctions() {
        Integer count = runtimeJdbc.queryForObject(
                "SELECT count(*) FROM pg_proc p"
                        + " JOIN pg_namespace n ON n.oid = p.pronamespace"
                        + " WHERE n.nspname = 'vc'"
                        + " AND p.proname IN ('current_owner_id', 'identity_authenticate')",
                Integer.class);
        if (count == null || count != REQUIRED_FUNCTIONS.size()) {
            throw new IllegalStateException(
                    "required SD functions missing: " + REQUIRED_FUNCTIONS);
        }
    }

    private void checkRuntimeRoles() {
        Integer count = runtimeJdbc.queryForObject(
                "SELECT count(*) FROM pg_roles WHERE rolname IN"
                        + " ('vc_api', 'vc_worker', 'vc_job_coordinator', 'vc_dispatcher')",
                Integer.class);
        if (count == null || count != RUNTIME_ROLES.size()) {
            throw new IllegalStateException("runtime roles missing: " + RUNTIME_ROLES);
        }
    }

    private void checkSchemaHistory() {
        String historyTable =
                migratorJdbc.queryForObject("SELECT to_regclass('flyway_schema_history')::text", String.class);
        if (!StringUtils.hasText(historyTable)) {
            throw new IllegalStateException(
                    "schema history missing: in-app Flyway never applied the schema");
        }
        Integer applied = migratorJdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE version = ? AND success",
                Integer.class,
                Integer.toString(expectedSchemaVersion));
        if (applied == null || applied != 1) {
            throw new IllegalStateException(
                    "schema version behind: expected " + expectedSchemaVersion);
        }
        Integer failed = migratorJdbc.queryForObject(
                "SELECT count(*) FROM flyway_schema_history WHERE NOT success", Integer.class);
        if (failed == null || failed > 0) {
            throw new IllegalStateException("failed migration rows present in schema history");
        }
    }

    private static String schemaUnavailableReason(RuntimeException ex) {
        String message = ex.getMessage();
        return message == null ? ex.getClass().getSimpleName() : message;
    }

    /**
     * Newest migration version number among {@code db/migration/V*.sql} on the
     * classpath (the persistence module jar ships them as resources). The
     * repository convention is {@code V<number>__...sql}; a missing classpath
     * yields 0, which keeps the gate inert for contexts without migrations.
     */
    static int expectedSchemaVersionFromClasspath() {
        int max = 0;
        try {
            Resource[] resources =
                    new PathMatchingResourcePatternResolver().getResources(MIGRATION_LOCATION_PATTERN);
            for (Resource resource : resources) {
                Matcher matcher = MIGRATION_VERSION_PREFIX.matcher(resource.getFilename());
                if (matcher.find()) {
                    max = Math.max(max, Integer.parseInt(matcher.group(1)));
                }
            }
        } catch (IOException ex) {
            throw new IllegalStateException("cannot resolve classpath migrations", ex);
        }
        return max;
    }
}
