package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.generation_feedback} row (V35, FEEDBACK / FR-CHAT-003).
 *
 * <p>The row is owner-scoped by the surrounding tenant context; the record
 * itself carries the wire-relevant fields only (generation id, catalog kind
 * code, optional note, creation timestamp). {@code note} is null when the
 * caller submitted none or an idempotent repeat resolved to an existing row.
 */
public record GenerationFeedbackRecord(
        long generationId,
        String kind,
        String note,
        Instant createdAt) {

    public GenerationFeedbackRecord {
        if (generationId <= 0) {
            throw new IllegalArgumentException("generationId must be positive");
        }
        Objects.requireNonNull(kind, "kind must not be null");
        if (kind.isBlank()) {
            throw new IllegalArgumentException("kind must not be blank");
        }
        Objects.requireNonNull(createdAt, "createdAt must not be null");
    }
}
