package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.memory_item} row surfaced by the V11/V12/V13 SECURITY DEFINER
 * functions (TASK-0180).
 *
 * <p>Maps the union of the {@code get_memory} output columns (which include
 * {@code out_relationship_id} and never return soft-deleted rows) and the
 * {@code list_memory} output columns (which include {@code out_deleted_at}
 * when {@code includeDeleted} is set): {@code relationshipId} is {@code null}
 * on the list path and {@code deletedAt} is {@code null} on the get path. The
 * status follows the memory-candidate-statuses catalog
 * ({@code PENDING_CONFIRMATION} candidates are created by model extraction;
 * {@code ACCEPTED} is reached only through user confirmation, INV-MEM-001/002).
 */
public record MemoryRecord(
        long id,
        Long relationshipId,
        String scope,
        String summary,
        String status,
        Long conversationId,
        Instant deletedAt,
        Instant createdAt) {

    public MemoryRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(scope, "scope must not be null");
        if (scope.isBlank()) {
            throw new IllegalArgumentException("scope must not be blank");
        }
        Objects.requireNonNull(summary, "summary must not be null");
        Objects.requireNonNull(status, "status must not be null");
        if (status.isBlank()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        if (conversationId != null && conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        if (createdAt == null) {
            throw new IllegalArgumentException("createdAt must not be null");
        }
    }
}
