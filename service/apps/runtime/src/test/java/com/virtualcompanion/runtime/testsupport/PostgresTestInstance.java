package com.virtualcompanion.runtime.testsupport;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.Properties;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * DOGFOOD-STABILIZATION-04 (audit defects A/G): a REAL PostgreSQL 18 +
 * pgvector instance for Java integration tests — launched as an anonymous
 * disposable docker container (OrbStack runtime; the same frozen image the
 * SQL harness uses), migrated with the repository's Flyway SQL files, bound
 * to a random loopback port, and torn down on JVM exit.
 *
 * <p>No Testcontainers dependency: the container lifecycle mirrors
 * {@code infra/db/run-rls-tests.sh} (docker run -d --rm, readiness by
 * consecutive SQL probes, migrations piped through {@code docker exec psql}
 * in version order). The owner-binding secret is the same FIXED test-only
 * key the SQL harness seeds (tests/00_owner_binding_secret_seed.sql).</p>
 */
public final class PostgresTestInstance {

    /** The fixed test-only V27 owner-binding key (SQL harness parity). */
    public static final String TEST_OWNER_BINDING_SECRET =
            "vc-test-owner-binding-secret-0123456789abcdef";

    private static final String IMAGE = "pgvector/pgvector:0.8.5-pg18";
    private static final String DB_NAME = "vc";
    private static final String SUPERUSER = "postgres";
    private static final String SUPERUSER_PASSWORD = "vc";

    private static PostgresTestInstance started;

    private final String containerId;
    private final int port;
    private final String jdbcUrl;

    private PostgresTestInstance(String containerId, int port) {
        this.containerId = containerId;
        this.port = port;
        this.jdbcUrl = "jdbc:postgresql://127.0.0.1:" + port + "/" + DB_NAME;
    }

    /** The shared singleton (one container per test JVM). */
    public static synchronized PostgresInstanceHandle get() {
        if (started == null) {
            started = start();
        }
        return new PostgresInstanceHandle(started);
    }

    private static PostgresTestInstance start() {
        try {
            String containerId = exec(List.of(
                    "docker", "run", "-d", "--rm",
                    "--name", "vc-java-it-" + ProcessHandle.current().pid(),
                    "-e", "POSTGRES_PASSWORD=" + SUPERUSER_PASSWORD,
                    "-e", "POSTGRES_DB=" + DB_NAME,
                    "-p", "127.0.0.1::5432",
                    IMAGE)).trim();
            Runtime.getRuntime().addShutdownHook(new Thread(
                    () -> execQuiet(List.of("docker", "rm", "-f", containerId)),
                    "vc-java-it-postgres-shutdown"));
            int port = Integer.parseInt(exec(List.of(
                    "docker", "port", containerId, "5432/tcp"))
                    .trim().lines().findFirst().orElseThrow()
                    .replaceAll(".*:", ""));
            awaitReadiness(containerId, port);
            applyMigrations(containerId);
            seedOwnerBindingSecret(containerId);
            return new PostgresTestInstance(containerId, port);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException("postgres test instance failed to start", e);
        }
    }

    private static void awaitReadiness(String containerId, int port) throws SQLException {
        Properties props = new Properties();
        props.setProperty("user", SUPERUSER);
        props.setProperty("password", SUPERUSER_PASSWORD);
        Deadline deadline = new Deadline(Duration.ofSeconds(120));
        SQLException last = null;
        while (!deadline.expired()) {
            try (Connection connection = DriverManager.getConnection(
                    "jdbc:postgresql://127.0.0.1:" + port + "/" + DB_NAME, props);
                 Statement statement = connection.createStatement()) {
                statement.execute("SELECT 1");
                return;
            } catch (SQLException e) {
                last = e;
                sleep(500);
            }
        }
        throw new IllegalStateException("postgres test instance never became ready", last);
    }

    private static void applyMigrations(String containerId) throws IOException, InterruptedException {
        List<Path> migrations = Files.list(findRepoRoot().resolve(
                        "service/platform/persistence/src/main/resources/db/migration"))
                .filter(path -> {
                    String name = path.getFileName().toString();
                    return name.matches("V\\d+__.*\\.sql");
                })
                .sorted(Comparator.comparingLong(PostgresTestInstance::migrationVersion))
                .toList();
        if (migrations.isEmpty()) {
            throw new IllegalStateException("no migrations found under the repo root");
        }
        for (Path migration : migrations) {
            execWithInput(containerId, migration);
        }
    }

    private static void seedOwnerBindingSecret(String containerId)
            throws IOException, InterruptedException {
        exec(List.of("docker", "exec", "-i", containerId,
                "psql", "-U", SUPERUSER, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q",
                "-c", "INSERT INTO vc._owner_binding_secret(id, secret) VALUES (1, '"
                        + TEST_OWNER_BINDING_SECRET + "') ON CONFLICT (id) DO NOTHING"));
    }

    private static long migrationVersion(Path path) {
        String name = path.getFileName().toString();
        return Long.parseLong(name.substring(1, name.indexOf("__")));
    }

    private static void execWithInput(String containerId, Path sqlFile)
            throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(List.of(
                "docker", "exec", "-i", containerId,
                "psql", "-U", SUPERUSER, "-d", DB_NAME, "-v", "ON_ERROR_STOP=1", "-q"));
        builder.redirectInput(sqlFile.toFile());
        builder.redirectErrorStream(true);
        Process process = builder.start();
        // Drain stdout so a large migration log cannot block the pipe.
        byte[] output = process.getInputStream().readAllBytes();
        if (process.waitFor() != 0) {
            throw new IllegalStateException("migration failed ("
                    + sqlFile.getFileName() + "): "
                    + new String(output).lines().toList()
                            .stream().filter(line -> line.contains("ERROR"))
                            .findFirst().orElse("exit != 0"));
        }
    }

    private static String exec(List<String> command)
            throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(command);
        builder.redirectErrorStream(false);
        Process process = builder.start();
        String output = new String(process.getInputStream().readAllBytes());
        if (process.waitFor() != 0) {
            throw new IllegalStateException(
                    "command failed (" + command.getFirst() + "): "
                            + new String(process.getErrorStream().readAllBytes()));
        }
        return output;
    }

    private static void execQuiet(List<String> command) {
        try {
            ProcessBuilder builder = new ProcessBuilder(command);
            builder.redirectErrorStream(true);
            Process process = builder.start();
            process.getInputStream().readAllBytes();
            process.waitFor();
        } catch (Exception ignored) {
            // best-effort teardown of a disposable container
        }
    }

    private static void sleep(long millis) {
        try {
            Thread.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while waiting for postgres", e);
        }
    }

    private static Path findRepoRoot() {
        Path dir = Path.of("").toAbsolutePath();
        for (Path current = dir; current != null; current = current.getParent()) {
            if (Files.exists(current.resolve("ops/deploy/docker-compose.yml"))
                    && Files.exists(current.resolve(".git"))) {
                return current;
            }
        }
        throw new IllegalStateException("repo root not found above " + dir);
    }

    private static final class Deadline {
        private final long deadlineNanos;

        Deadline(Duration duration) {
            this.deadlineNanos = System.nanoTime() + duration.toNanos();
        }

        boolean expired() {
            return System.nanoTime() > deadlineNanos;
        }
    }

    /**
     * DriverManagerDataSource that connects as the migration superuser and
     * immediately SET ROLE vc_api — the runtime role every business-path
     * JdbcTemplate/transaction uses in production (FORCE-RLS applies).
     */
    public static final class RoleDataSource extends DriverManagerDataSource {
        public RoleDataSource(String url) {
            super(url, "postgres", "vc");
        }

        @Override
        public Connection getConnection() throws SQLException {
            Connection connection = super.getConnection();
            try (Statement statement = connection.createStatement()) {
                statement.execute("SET ROLE vc_api");
            }
            return connection;
        }

        @Override
        public Connection getConnection(String username, String password) throws SQLException {
            return getConnection();
        }
    }

    /**
     * Handle over the shared instance: exposes the JDBC URL and superuser
     * connections; per-test fixtures run as the superuser (the migration
     * owner) and business paths connect with the app role credentials.
     */
    public record PostgresInstanceHandle(PostgresTestInstance instance) {

        public String jdbcUrl() {
            return instance.jdbcUrl;
        }

        public int port() {
            return instance.port;
        }

        /** Open a SUPERUSER connection (fixture/DDL side). */
        public Connection superuserConnection() throws SQLException {
            Properties props = new Properties();
            props.setProperty("user", SUPERUSER);
            props.setProperty("password", SUPERUSER_PASSWORD);
            return DriverManager.getConnection(instance.jdbcUrl, props);
        }

        /** Open a vc_api connection (the runtime role; FORCE-RLS applies). */
        public Connection apiConnection() throws SQLException {
            Properties props = new Properties();
            props.setProperty("user", SUPERUSER);
            props.setProperty("password", SUPERUSER_PASSWORD);
            Connection connection = DriverManager.getConnection(instance.jdbcUrl, props);
            try (Statement statement = connection.createStatement()) {
                statement.execute("SET ROLE vc_api");
            }
            return connection;
        }
    }
}
