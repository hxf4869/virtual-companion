package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.memory_evidence} row surfaced by the V12
 * {@code vc.list_memory_evidence} SECURITY DEFINER function (TASK-0180).
 *
 * <p>Maps the {@code out_id / out_source_ref / out_created_at} output columns.
 * The evidence chain supports a memory candidate with the cited source
 * references that motivated the model extraction; a memory that carries no
 * evidence is indistinguishable from a foreign/absent id (the SD returns no
 * rows either way, so existence is never disclosed).
 */
public record MemoryEvidenceRecord(long id, String sourceRef, Instant createdAt) {

    public MemoryEvidenceRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(sourceRef, "sourceRef must not be null");
        if (sourceRef.isBlank()) {
            throw new IllegalArgumentException("sourceRef must not be blank");
        }
        if (createdAt == null) {
            throw new IllegalArgumentException("createdAt must not be null");
        }
    }
}
