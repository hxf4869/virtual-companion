package com.virtualcompanion.runtime.export;

import io.minio.BucketExistsArgs;
import io.minio.GetObjectArgs;
import io.minio.ListObjectsArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.RemoveObjectArgs;
import io.minio.Result;
import io.minio.messages.Item;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import okhttp3.OkHttpClient;

/**
 * DOGFOOD-02 (ADR-0006 §7.3): MinIO adapter for {@link ExportObjectStorage}.
 *
 * <p>Fail-fast construction: when the adapter is enabled the bucket must
 * already exist (created once by the compose {@code minio-init} service) —
 * startup refuses instead of silently auto-creating storage. Credentials are
 * injected from deployment env; nothing here logs them.
 *
 * <p>{@link #delete} maps MinIO's idempotent removeObject: an absent object
 * is success. Real backend errors propagate as {@link RuntimeException} so
 * callers alert and the expiry sweep retries.
 */
public final class MinioExportObjectStorage implements ExportObjectStorage {

    /** Opaque encrypted envelope — deliberately NOT application/json. */
    private static final String CONTENT_TYPE_ENVELOPE = "application/octet-stream";

    /**
     * DOGFOOD-STABILIZATION-07: the per-HTTP-CALL timeout for storage
     * operations. A multipart upload of a multi-MiB envelope issues MANY
     * calls (one per 5 MiB part plus the complete call), so this bounds each
     * individual call — it is NOT a bound on the whole upload's duration,
     * and the upload lease is therefore kept alive by the worker's durable
     * heartbeat (see DataExportWorkItemHandler) instead of by this timeout.
     * The bound still matters for the protocol's derivations: an aborted
     * upload's last in-flight call ends within it, and every heartbeat-miss
     * window is comparable to it.
     */
    public static final Duration CALL_TIMEOUT = Duration.ofSeconds(60);

    private final String endpoint;
    private final MinioClient client;
    private final String bucket;

    public MinioExportObjectStorage(
            String endpoint, String accessKey, String secretKey, String bucket) {
        this(endpoint, accessKey, secretKey, bucket, CALL_TIMEOUT);
    }

    public MinioExportObjectStorage(
            String endpoint, String accessKey, String secretKey, String bucket,
            Duration callTimeout) {
        this.endpoint = Objects.requireNonNull(endpoint, "endpoint must not be null");
        if (endpoint.isBlank()) {
            throw new IllegalArgumentException("object-storage endpoint must not be blank");
        }
        if (accessKey == null || accessKey.isBlank()) {
            throw new IllegalArgumentException("object-storage access key must not be blank");
        }
        if (secretKey == null || secretKey.isBlank()) {
            throw new IllegalArgumentException("object-storage secret key must not be blank");
        }
        if (bucket == null || bucket.isBlank()) {
            throw new IllegalArgumentException("object-storage bucket must not be blank");
        }
        if (callTimeout == null || callTimeout.isNegative() || callTimeout.isZero()) {
            throw new IllegalArgumentException("callTimeout must be positive");
        }
        this.bucket = bucket;
        this.client = MinioClient.builder()
                .endpoint(endpoint)
                .credentials(accessKey, secretKey)
                // 06: one OkHttp callTimeout bounds every storage operation
                // (put above all) — the bounded upload window the lease is
                // sized against.
                .httpClient(new OkHttpClient.Builder()
                        .callTimeout(callTimeout)
                        .build())
                .build();
        // Fail fast: an enabled object-storage consumer must find its bucket.
        // No auto-creation — the bucket is provisioned by ops (minio-init),
        // and a missing bucket means the deployment is wrong.
        try {
            if (!client.bucketExists(BucketExistsArgs.builder().bucket(bucket).build())) {
                throw new IllegalStateException(
                        "export object-storage bucket does not exist (endpoint configured, "
                                + "bucket missing): refusing to start");
            }
        } catch (IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            throw new IllegalStateException(
                    "export object-storage is unreachable at startup: " + e.getMessage(), e);
        }
    }

    /** The configured endpoint (diagnostics only, no credentials). */
    public String endpoint() {
        return endpoint;
    }

    @Override
    public void put(String key, byte[] bytes) {
        requireKey(key);
        Objects.requireNonNull(bytes, "bytes must not be null");
        put(key, new ByteArrayInputStream(bytes), bytes.length);
    }

    @Override
    public void put(String key, InputStream stream, long length) {
        requireKey(key);
        Objects.requireNonNull(stream, "stream must not be null");
        if (length < 0) {
            throw new IllegalArgumentException("length must not be negative");
        }
        try {
            client.putObject(PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(key)
                    .stream(stream, length, -1)
                    .contentType(CONTENT_TYPE_ENVELOPE)
                    .build());
        } catch (Exception e) {
            throw new IllegalStateException("export object upload failed for key", e);
        }
    }

    @Override
    public byte[] get(String key) {
        requireKey(key);
        try (InputStream stream = client.getObject(
                GetObjectArgs.builder().bucket(bucket).object(key).build())) {
            return stream.readAllBytes();
        } catch (Exception e) {
            throw new IllegalStateException("export object download failed for key", e);
        }
    }

    @Override
    public void delete(String key) {
        requireKey(key);
        try {
            client.removeObject(
                    RemoveObjectArgs.builder().bucket(bucket).object(key).build());
        } catch (Exception e) {
            throw new IllegalStateException("export object delete failed for key", e);
        }
    }

    @Override
    public List<String> list(String prefix) {
        // Bounded to one page — the handler's post-seal sweep addresses a
        // single export's attempt keys, and the backend's lazy auto-paging
        // iterator must never be drained past a fixed bound.
        return listPage(prefix, null, 1000).keys();
    }

    @Override
    public ObjectListing listPage(String prefix, String startAfter, int limit) {
        if (prefix == null || prefix.isBlank() || prefix.startsWith("/") || prefix.contains("..")) {
            throw new IllegalArgumentException("object prefix must be a plain relative prefix");
        }
        if (limit < 1 || limit > 1000) {
            throw new IllegalArgumentException("limit must be within 1..1000");
        }
        ListObjectsArgs.Builder args = ListObjectsArgs.builder()
                .bucket(bucket)
                .prefix(prefix)
                // 07 (defect A): RECURSIVE — a non-recursive listing returns
                // the owner-directory common prefixes ("exports/1/") as
                // pseudo-items, never the actual object keys, so the audit
                // would see directory markers instead of objects and the
                // real late-landed objects would never be enumerated.
                .recursive(true)
                .maxKeys(limit);
        if (startAfter != null && !startAfter.isBlank()) {
            args = args.startAfter(startAfter);
        }
        try {
            List<String> keys = new ArrayList<>(Math.min(limit, 64));
            for (Result<Item> entry : client.listObjects(args.build())) {
                Item item = entry.get();
                if (item.isDir()) {
                    // Directory/common-prefix pseudo-items are never objects
                    // and must never be counted or deleted as keys.
                    continue;
                }
                keys.add(item.objectName());
                // Stop after exactly `limit` consumed OBJECT entries: the
                // SDK's iterator auto-fetches the NEXT page inside
                // hasNext(), so consuming past the bound would silently
                // load the whole prefix into memory.
                if (keys.size() >= limit) {
                    break;
                }
            }
            String nextCursor = keys.size() < limit
                    ? null
                    : keys.get(keys.size() - 1);
            return new ObjectListing(List.copyOf(keys), nextCursor);
        } catch (Exception e) {
            throw new IllegalStateException("export object listing failed", e);
        }
    }

    private static void requireKey(String key) {
        if (key == null || key.isBlank() || key.startsWith("/") || key.contains("..")) {
            throw new IllegalArgumentException("object key must be a plain relative key");
        }
    }
}
