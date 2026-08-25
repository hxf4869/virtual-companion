package com.virtualcompanion.runtime.export;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/**
 * DOGFOOD-02 (ADR-0006 §7.3) real-MinIO drill — the TRUE object-storage
 * consumer exercise. NOT part of the regular unit suite: enabled only when
 * the harness exports {@code VC_S3_DRILL=1} plus
 * {@code VC_S3_DRILL_ENDPOINT/VC_S3_DRILL_ACCESS_KEY/VC_S3_DRILL_SECRET_KEY/
 * VC_S3_DRILL_BUCKET} (a throwaway {@code docker run --rm} MinIO on
 * 127.0.0.1 with synthetic credentials; everything is torn down afterwards).
 *
 * <p>Verifies, against real MinIO: the fail-fast bucket check; private
 * bucket semantics (anonymous GET refused); authenticated put/get/delete
 * over the OPAQUE envelope bytes (there is deliberately NO presigned-URL
 * path anymore — the only download entry is the one-time application
 * endpoint reading server-side); and idempotent deletion. Credentials only
 * come from env and are never printed.</p>
 */
@EnabledIfEnvironmentVariable(named = "VC_S3_DRILL", matches = "1")
class MinioExportObjectStorageDrillTest {

    private static final HttpClient HTTP = HttpClient.newHttpClient();

    private static MinioExportObjectStorage storage;
    private static String bucket;

    @BeforeAll
    static void wireStorage() {
        String endpoint = env("VC_S3_DRILL_ENDPOINT");
        String accessKey = env("VC_S3_DRILL_ACCESS_KEY");
        String secretKey = env("VC_S3_DRILL_SECRET_KEY");
        bucket = env("VC_S3_DRILL_BUCKET");
        storage = new MinioExportObjectStorage(endpoint, accessKey, secretKey, bucket);
    }

    private static String env(String name) {
        String value = System.getenv(name);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(name + " must be exported for the drill");
        }
        return value;
    }

    private static int getUrl(String url) throws Exception {
        HttpResponse<byte[]> response = HTTP.send(
                HttpRequest.newBuilder(URI.create(url)).GET().build(),
                HttpResponse.BodyHandlers.ofByteArray());
        return response.statusCode();
    }

    @Test
    void drillPrivateBucketEnvelopeRoundTripAndDeleteLifecycle() throws Exception {
        String key = "exports/990001/990001.json";
        // Opaque envelope bytes (enc2: ASCII string), as uploaded in production.
        byte[] envelope = ("enc2:default:1:" + java.util.Base64.getEncoder()
                .encodeToString(new byte[64]))
                .getBytes(StandardCharsets.UTF_8);

        // 1. Authenticated upload + read-back (byte-identical envelope).
        storage.put(key, envelope);
        assertArrayEquals(envelope, storage.get(key));

        // 2. The bucket is private: an anonymous GET is refused — the only
        // download entry is the application's one-time endpoint.
        String endpoint = System.getenv("VC_S3_DRILL_ENDPOINT");
        int anonymous = getUrl(
                endpoint.replaceAll("/$", "") + "/" + bucket + "/" + key);
        org.junit.jupiter.api.Assertions.assertTrue(
                anonymous == 403 || anonymous == 401,
                "anonymous GET must be refused, got " + anonymous);

        // 3. Delete, then the object is gone; deleting again is idempotent.
        storage.delete(key);
        assertThrows(RuntimeException.class, () -> storage.get(key));
        storage.delete(key);
    }

    @Test
    void drillRefusesToStartWhenTheBucketIsMissing() {
        String endpoint = System.getenv("VC_S3_DRILL_ENDPOINT");
        String accessKey = System.getenv("VC_S3_DRILL_ACCESS_KEY");
        String secretKey = System.getenv("VC_S3_DRILL_SECRET_KEY");
        String missing = "vc-drill-missing-bucket-" + System.nanoTime();
        IllegalStateException e = assertThrows(IllegalStateException.class,
                () -> new MinioExportObjectStorage(endpoint, accessKey, secretKey, missing));
        org.junit.jupiter.api.Assertions.assertTrue(
                e.getMessage().contains("bucket"),
                "fail-fast message must point at the bucket");
    }
}
