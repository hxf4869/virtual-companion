package com.virtualcompanion.runtime.export;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

/**
 * DOGFOOD-STABILIZATION-07 defects A and B against a REAL local MinIO
 * (an ephemeral docker container, no drill flag, never skipped): the
 * recursive prefix listing across owner sub-directories with cursor paging
 * (directory pseudo-keys filtered), and a multipart upload larger than one
 * part whose TOTAL duration exceeds the per-call timeout — the exact
 * assumption the 06 round got wrong.
 *
 * <p>The database-side halves of the protocol (fence atomicity, claim/lease
 * re-validation, retirement) are proven by infra/db/tests/166 and 167; this
 * class proves the storage-side behavior those tests assume: real keys are
 * enumerated recursively across owners, unrecorded objects are really
 * deleted while recorded ones stay, and a multi-call multipart upload
 * completes although its total duration outlives any single call timeout.</p>
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class MinioExportObjectStorageIntegrationTest {

    /** Test-only credentials for the ephemeral container (not real secrets). */
    private static final String TEST_ACCESS_KEY = "it-test-access";
    private static final String TEST_SECRET_KEY = "it-test-secret-0123456789";
    private static final String BUCKET = "vc-export-it";

    private static String containerId;
    private static int port;
    private static MinioExportObjectStorage storage;

    @BeforeAll
    static void startRealMinio() throws Exception {
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
        String runOutput = new String(run.getInputStream().readAllBytes()).trim();
        assertThat(run.waitFor()).isZero();
        // Health-gate the container (the server needs a moment; bounded waits).
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
        // Provision the bucket with a bare admin client (ops-equivalent of
        // the compose minio-init service), then construct the adapter under
        // test (whose fail-fast constructor requires the bucket to exist).
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
    void isolateBucket() {
        // Each test starts from an empty bucket (JUnit's method order is
        // unspecified — the scenarios must not leak objects into each other).
        String cursor = null;
        do {
            ExportObjectStorage.ObjectListing page = storage.listPage("exports/", cursor, 100);
            for (String key : page.keys()) {
                storage.delete(key);
            }
            cursor = page.nextCursor();
        } while (cursor != null);
    }

    private static byte[] randomBytes(int size) {
        byte[] data = new byte[size];
        new SecureRandom().nextBytes(data);
        return data;
    }

    @Test
    void recursiveListingWalksOwnerSubdirectoriesWithCursorPaging() {
        // Two owner sub-directories, keys that STRADDLE page boundaries, and
        // a deliberately small page bound: the recursive walk must enumerate
        // every actual object exactly once, never emit the directory
        // pseudo-keys ("exports/1/"), and the cursor must resume strictly
        // after the last key of the previous page.
        List<String> expected = new ArrayList<>();
        // Owners 3/4 are exclusive to this test (the audit test keeps its
        // recorded object under 7/ — the shared bucket must not leak between
        // the scenarios).
        for (int owner = 3; owner <= 4; owner++) {
            for (int i = 0; i < 6; i++) {
                String key = String.format("exports/%d/%d-%013d.json", owner, owner, i);
                storage.put(key, ("page-" + key).getBytes());
                expected.add(key);
            }
        }
        expected.sort(String::compareTo);

        List<String> walked = new ArrayList<>();
        String cursor = null;
        int pages = 0;
        do {
            ExportObjectStorage.ObjectListing page =
                    storage.listPage("exports/", cursor, 4);
            walked.addAll(page.keys());
            cursor = page.nextCursor();
            pages++;
            assertThat(pages).isLessThanOrEqualTo(expected.size() + 2);
        } while (cursor != null);

        assertThat(walked).containsExactlyInAnyOrderElementsOf(expected);
        assertThat(walked).doesNotHaveDuplicates();
        // Directory pseudo-keys never surface as objects.
        for (String key : walked) {
            assertThat(key).matches("exports/\\d+/\\d+-\\d+\\.json");
        }
        // The cursor resumes STRICTLY after its startAfter key.
        ExportObjectStorage.ObjectListing resumed =
                storage.listPage("exports/", walked.get(2), 100);
        assertThat(resumed.keys()).containsExactlyElementsOf(
                expected.subList(3, expected.size()));
    }

    @Test
    void theFencedAuditDeletesOnlyTheUnrecordedLateObject() {
        // The storage-side half of the account-deletion convergence (the
        // fence's database atomicity is proven by infra/db/tests/167): a
        // recorded pointer/intent object stays; the late-landed object with
        // NO record is really deleted from the bucket, and a re-listing no
        // longer sees it.
        String recorded = "exports/7/70-aaaaaaaaaaaaaaaa.json";
        String orphan = "exports/7/70-bbbbbbbbbbbbbbbb.json";
        storage.put(recorded, new byte[] {1});
        storage.put(orphan, new byte[] {2});
        Set<String> recordedKeys = Set.of(recorded);

        // The audit's walk (recorded-set judgment stands in for the fenced
        // objectHasRecord + fence gate).
        for (ExportObjectStorage.ObjectListing page = storage.listPage("exports/", null, 2); ; ) {
            for (String key : page.keys()) {
                if (key.startsWith("exports/7/") && !recordedKeys.contains(key)) {
                    storage.delete(key);
                }
            }
            if (page.nextCursor() == null) {
                break;
            }
            page = storage.listPage("exports/", page.nextCursor(), 2);
        }

        assertThat(storage.get(recorded)).isEqualTo(new byte[] {1});
        List<String> remaining = storage.list("exports/7/");
        assertThat(remaining).containsExactly(recorded);
    }

    @Test
    void aMultipartUploadOutlivesThePerCallTimeoutAndStillCompletes() throws Exception {
        // 07 (defect B): a >5 MiB upload is multipart — multiple HTTP calls.
        // With a throttled source the TOTAL duration exceeds the per-call
        // timeout while every individual call stays under it: the upload
        // must still complete (the 06 assumption "one call timeout bounds
        // the whole put" is exactly what this disproves), and the bytes
        // round-trip unchanged.
        byte[] payload = randomBytes(8 * 1024 * 1024);
        String key = "exports/9/90-0123456789abcdef.json";
        MinioExportObjectStorage slowBounded = new MinioExportObjectStorage(
                "http://127.0.0.1:" + port, TEST_ACCESS_KEY, TEST_SECRET_KEY, BUCKET,
                Duration.ofSeconds(4));
        long startedAt = System.nanoTime();
        slowBounded.put(key, throttled(payload, 100), payload.length);
        long elapsedMs = (System.nanoTime() - startedAt) / 1_000_000;

        // The upload took MULTIPLE per-call windows to finish — it can never
        // be justified by a single call timeout — yet completed intact.
        assertThat(elapsedMs).isGreaterThan(4_000L);
        assertThat(storage.get(key)).isEqualTo(payload);
        storage.delete(key);
    }

    /** A source that pauses briefly every ~128 KiB (deterministic pacing). */
    private static InputStream throttled(byte[] data, long pauseMillis) {
        return new InputStream() {
            private int position;

            @Override
            public int read() {
                return single();
            }

            @Override
            public int read(byte[] buffer, int offset, int length) throws IOException {
                if (position >= data.length) {
                    return -1;
                }
                int chunk = Math.min(Math.min(length, 128 * 1024), data.length - position);
                System.arraycopy(data, position, buffer, offset, chunk);
                position += chunk;
                try {
                    Thread.sleep(pauseMillis);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IOException("interrupted", e);
                }
                return chunk;
            }

            private int single() {
                return position >= data.length ? -1 : (data[position++] & 0xFF);
            }
        };
    }
}
