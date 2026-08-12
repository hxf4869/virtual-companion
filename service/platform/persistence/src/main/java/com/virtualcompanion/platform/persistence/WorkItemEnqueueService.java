package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Enqueues a PENDING {@code work_item} bound to the
 * {@code vc.enqueue_work_item} SECURITY DEFINER function (TASK-0174 V25).
 *
 * <p>The runtime API role ({@code vc_api}) has no direct INSERT on
 * {@code work_item} (V5 grants only column-level SELECT to
 * {@code vc_job_coordinator} and SELECT to {@code vc_worker}); the V25
 * SECURITY DEFINER function performs the insert under the definer identity so
 * the caller stays isolated by FORCE RLS. The function allocates the id from
 * {@code vc.work_item_id_seq} and binds {@code vc.owner_user_id} for the
 * transaction; the caller must already be inside a server-trusted owner context
 * (V17 trusted-owner assertion).
 *
 * <p>{@code kind} / {@code refId} / {@code payload} are opaque worker metadata
 * (for a generation work item: {@code kind='GENERATION'},
 * {@code refId=generationId}). The coordinator never reads {@code payload}
 * (V5 column-level grant excludes it); only the worker consumes it.
 */
public class WorkItemEnqueueService {

    private final JdbcTemplate jdbc;

    public WorkItemEnqueueService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * Enqueue a PENDING work item for the owner.
     *
     * @param kind   non-blank worker category (e.g. {@code "GENERATION"})
     * @param refId  owner-scoped reference id (e.g. generation id)
     * @param payload opaque worker data; {@code null} allowed
     * @return the allocated work item id
     */
    public long enqueue(long ownerUserId, String kind, long refId, byte[] payload) {
        validateEnqueue(ownerUserId, kind, refId);
        Long id = jdbc.queryForObject(
                "SELECT vc.enqueue_work_item(?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                kind,
                refId,
                payload);
        if (id == null || id <= 0) {
            throw new IllegalStateException("enqueue_work_item returned no id");
        }
        return id;
    }

    /** Convenience overload without payload. */
    public long enqueue(long ownerUserId, String kind, long refId) {
        return enqueue(ownerUserId, kind, refId, null);
    }

    static void validateEnqueue(long ownerUserId, String kind, long refId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (kind == null || kind.isBlank()) {
            throw new IllegalArgumentException("kind must not be blank");
        }
        if (refId <= 0) {
            throw new IllegalArgumentException("refId must be positive");
        }
    }
}
