package com.virtualcompanion.runtime.export;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.auth.application.AccountDeletionCoordinator;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.testsupport.PostgresTestInstance;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

/**
 * DOGFOOD-STABILIZATION-08 defect C: the account-deletion convergence as one
 * REAL combination — a real PostgreSQL 18 instance carrying the repository's
 * full Flyway schema (fence protocol included), a REAL local MinIO container
 * holding the actual objects, and the PRODUCTION
 * {@link ExportUploadReconciliationScheduler} driving its real three-phase
 * pass (no Set standing in for the database fence, no fake storage).
 *
 * <p>The two scenarios mirror infra/db/tests/168 end to end with real bytes:
 * the clean path (the {@link AccountDeletionCoordinator} deletes the live
 * object and releases every record before the cascade) and the pathological
 * path (the cascade commits while the worker's WRITER fence is still live —
 * the fence survives ORPHANED and the audit must take it over). In both, a
 * LATE object lands under the deleted owner's prefix afterwards and the
 * scheduler's fenced prefix audit must finally delete it from the real
 * bucket — idempotently, pass after pass.</p>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class ExportDeletedOwnerConvergenceIntegrationTest {

    /** Test-only credentials for the ephemeral container (not real secrets). */
    private static final String TEST_ACCESS_KEY = "it-test-access";
    private static final String TEST_SECRET_KEY = "it-test-secret-0123456789";
    private static final String BUCKET = "vc-export-it";

    /** Owner id exclusive to this class (other Postgres tests use 51/61/7/9). */
    private static final long OWNER = 71L;

    private static String containerId;
    private static int port;
    private static MinioExportObjectStorage storage;

    private PostgresTestInstance.PostgresInstanceHandle postgres;
    private JdbcTemplate jdbc;
    private OwnerContext ownerContext;
    private ExportService exports;

    @BeforeAll
    void startRealMinioAndPostgres() throws Exception {
        Process docker = new ProcessBuilder("docker", "version", "--format", "{{.Server.Version}}")
                .redirectErrorStream(true)
                .start();
        if (docker.waitFor() != 0) {
            throw new IllegalStateException("docker is required for this integration test");
        }
        port = 19000 + new SecureRandom().nextInt(1000);
        containerId = "vc-s3-it-" + Long.toHexString(System.nanoTime());
        Process run = new ProcessBuilder(
                "docker", "run", "-d", "--rm",
                "--name", containerId,
                "-p", "127.0.0.1:" + port + ":9000",
                "-e", "MINIO_ROOT_USER=" + TEST_ACCESS_KEY,
                "-e", "MINIO_ROOT_PASSWORD=" + TEST_SECRET_KEY,
                "minio/minio:RELEASE.2025-09-07T16-13-09Z@sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e", "server", "/data")
                .redirectErrorStream(true)
                .start();
        new String(run.getInputStream().readAllBytes());
        assertThat(run.waitFor()).isZero();
        long deadline = System.currentTimeMillis() + 60_000;
        boolean healthy = false;
        while (System.currentTimeMillis() < deadline) {
            try {
                HttpURLConnection probe =
                        (HttpURLConnection) new URL(
                                "http://127.0.0.1:" + port + "/minio/health/live")
                                .openConnection();
                probe.setConnectTimeout(1000);
                probe.setReadTimeout(1000);
                if (probe.getResponseCode() == 200) {
                    healthy = true;
                    break;
                }
            } catch (IOException e) {
                // not up yet
            }
            Thread.sleep(250);
        }
        assertThat(healthy).as("the ephemeral MinIO must become healthy").isTrue();
        io.minio.MinioClient admin = io.minio.MinioClient.builder()
                .endpoint("http://127.0.0.1:" + port)
                .credentials(TEST_ACCESS_KEY, TEST_SECRET_KEY)
                .build();
        // 08: /minio/health/live can answer 200 before the admin API is
        // fully initialized ("Server not initialized yet") — makeBucket is
        // retried inside a bounded window instead of racing it.
        long bucketDeadline = System.currentTimeMillis() + 30_000;
        while (true) {
            try {
                admin.makeBucket(io.minio.MakeBucketArgs.builder().bucket(BUCKET).build());
                break;
            } catch (io.minio.errors.ErrorResponseException e) {
                if (System.currentTimeMillis() > bucketDeadline
                        || !e.getMessage().contains("Server not initialized")) {
                    throw e;
                }
                Thread.sleep(250);
            }
        }
        storage = new MinioExportObjectStorage(
                "http://127.0.0.1:" + port, TEST_ACCESS_KEY, TEST_SECRET_KEY, BUCKET);

        postgres = PostgresTestInstance.get();
        var dataSource = new PostgresTestInstance.RoleDataSource(postgres.jdbcUrl());
        jdbc = new JdbcTemplate(dataSource);
        ownerContext = new OwnerContext(
                jdbc,
                new TransactionTemplate(new DataSourceTransactionManager(dataSource)),
                PostgresTestInstance.TEST_OWNER_BINDING_SECRET);
        exports = new ExportService(jdbc);
    }

    @AfterAll
    static void stopRealMinio() throws Exception {
        if (containerId != null) {
            new ProcessBuilder("docker", "rm", "-f", containerId)
                    .redirectErrorStream(true)
                    .start()
                    .waitFor();
        }
    }

    @BeforeEach
    void cleanSlate() throws Exception {
        // Every scenario starts from a clean database quadrant and an empty
        // export prefix in the real bucket.
        try (var connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("TRUNCATE vc.export_object_fence, vc.export_upload_intent, "
                    + "vc.export_request, vc.account_deletion_intent, vc.work_item, "
                    + "vc.identity_auth_event, vc.identity_account CASCADE");
            statement.execute("DELETE FROM vc.vc_user WHERE id = " + OWNER);
        }
        String cursor = null;
        do {
            ExportObjectStorage.ObjectListing page = storage.listPage("exports/", cursor, 100);
            for (String key : page.keys()) {
                storage.delete(key);
            }
            cursor = page.nextCursor();
        } while (cursor != null);
    }

    /** The production coordinator + scheduler wiring over the real pair. */
    private AccountDeletionCoordinator coordinator() {
        ActiveInvocationRegistry registry = new ActiveInvocationRegistry();
        ObjectProvider<ActiveInvocationRegistry> registryProvider = providerOf(registry);
        ObjectProvider<ExportObjectStorage> storageProvider = providerOf(storage);
        ObjectProvider<ExportService> exportProvider = providerOf(exports);
        return new AccountDeletionCoordinator(
                ownerContext,
                new AccountDeletionIntentService(jdbc),
                registryProvider, storageProvider, exportProvider, null);
    }

    private static <T> ObjectProvider<T> providerOf(T instance) {
        ObjectProvider<T> provider = mock(ObjectProvider.class);
        lenient().when(provider.getIfAvailable()).thenReturn(instance);
        return provider;
    }

    /** Seed the owner + a PENDING export + its recorded intent (worker mid-flight). */
    private String seedOwnerWithLiveUpload() {
        try (var connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO vc.vc_user(id, display_name) VALUES ("
                    + OWNER + ", 'late-owner')");
            // The account-deletion intent requires an ACTIVE identity account
            // (request_account_deletion_current gates on it).
            statement.execute("INSERT INTO vc.identity_account("
                    + "id, username, password_hash, role, status, display_name) VALUES ("
                    + OWNER + ", 'late-owner-71', 'x', 'USER', 'ACTIVE', 'late-owner')");
            statement.execute("INSERT INTO vc.relationship(owner_user_id, id, persona_ref, "
                    + "active) VALUES (" + OWNER + ", 1, 'gentle-listener', true)");
            statement.execute("INSERT INTO vc.conversation(owner_user_id, id, relationship_id, "
                    + "title) VALUES (" + OWNER + ", 1, 1, NULL)");
        } catch (SQLException e) {
            throw new IllegalStateException("owner fixture failed", e);
        }
        AtomicLong exportId = new AtomicLong();
        ownerContext.asOwner(OWNER, () -> exportId.set(exports.create(OWNER, "tok-168-java")));
        long id = exportId.get();
        String key = String.format("exports/%d/%d-0123456789abcdef.json", OWNER, id);
        // The production lease window the worker records with (90s —
        // DataExportWorkItemHandler.UPLOAD_LEASE_SECONDS is package-private
        // in the worker package; the value is its documented contract).
        ownerContext.asOwner(OWNER, () -> exports.recordUploadIntent(OWNER, id, key, 90));
        return key;
    }

    private int superuserCount(String sql) throws SQLException {
        try (var connection = postgres.superuserConnection();
             Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery(sql)) {
            rows.next();
            return rows.getInt(1);
        }
    }

    @Test
    void theCleanDeletedOwnersLateObjectConvergesThroughTheFencedAudit() throws Exception {
        String key = seedOwnerWithLiveUpload();
        storage.put(key, "the worker's real object".getBytes());

        // The REAL account deletion: durable intent, invocation cancel,
        // object cleanup (real MinIO delete + record release), pre-cascade
        // re-check — then the real cascade.
        coordinator().prepare(OWNER);
        try (var connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("DELETE FROM vc.vc_user WHERE id = " + OWNER);
        }

        // Owner, pointer and intent state are all gone; no fence row either
        // (the coordinator's clear released it).
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.vc_user WHERE id = " + OWNER)).isZero();
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.export_request WHERE owner_user_id = " + OWNER)).isZero();
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.export_upload_intent WHERE owner_user_id = "
                        + OWNER)).isZero();
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.export_object_fence WHERE object_key = '"
                        + key + "'")).isZero();

        // A LATE object lands under the deleted owner's prefix (a worker
        // whose in-flight put outlived the deletion).
        storage.put(key, "late".getBytes());
        assertThat(storage.get(key)).isEqualTo("late".getBytes());

        // The production scheduler's real pass: the audit's fence is created
        // OWNERLESS (the FK target is gone — defect A), the in-fence record
        // re-verification passes (no record exists — defect B), and the real
        // object is deleted from the real bucket.
        new ExportUploadReconciliationScheduler(exports, storage, null).runOnce();
        assertThat(storage.list("exports/")).isEmpty();

        // Idempotent convergence: a second late object, a second pass.
        storage.put(key, "late-again".getBytes());
        new ExportUploadReconciliationScheduler(exports, storage, null).runOnce();
        assertThat(storage.list("exports/")).isEmpty();
        // And no fence row survived the audit's own release.
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.export_object_fence WHERE object_key = '"
                        + key + "'")).isZero();
    }

    @Test
    void theOrphanedWriterFenceIsTakenOverAndTheLateObjectConverges() throws Exception {
        // The pathological path: the cascade commits while the worker's
        // WRITER fence is still live (the coordinator cleanup is bypassed —
        // the crash window). The fence survives ORPHANED (owner SET NULL);
        // the audit must take it over and still converge the late object.
        String key = seedOwnerWithLiveUpload();
        storage.put(key, "orphaned-writer object".getBytes());
        try (var connection = postgres.superuserConnection();
             Statement statement = connection.createStatement()) {
            statement.execute("DELETE FROM vc.vc_user WHERE id = " + OWNER);
        }

        // The orphaned WRITER fence survived the cascade (08 defect A).
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.export_object_fence WHERE object_key = '" + key
                        + "' AND holder = 'WRITER' AND owner_user_id IS NULL")).isEqualTo(1);

        // The scheduler's real pass takes the orphan over (RECLAIM), deletes
        // the unrecorded object from the real bucket and releases.
        new ExportUploadReconciliationScheduler(exports, storage, null).runOnce();
        assertThat(storage.list("exports/")).isEmpty();
        assertThat(superuserCount(
                "SELECT count(*) FROM vc.export_object_fence WHERE object_key = '"
                        + key + "'")).isZero();

        // Repeated passes stay convergent (the audit may fence the deleted
        // owner's key again at any time).
        storage.put(key, "late-after-takeover".getBytes());
        new ExportUploadReconciliationScheduler(exports, storage, null).runOnce();
        assertThat(storage.list("exports/")).isEmpty();
    }
}
