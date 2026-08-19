package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.age_appeal} row (V56, FR-AUTH-002).
 *
 * <p>An appeal is an append-only intake record: SUBMITTED from the moment the
 * user submits it, RESOLVED only through human review. It never rewrites a
 * verification result — the state flip to AGE_APPEAL_PENDING lives in the
 * V45 history as its own row.
 */
public record AgeAppealRecord(
        long id,
        String reason,
        String status,
        String resolutionNote,
        Instant createdAt,
        Instant resolvedAt) {

    public AgeAppealRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(reason, "reason must not be null");
        if (reason.isBlank()) {
            throw new IllegalArgumentException("reason must not be blank");
        }
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(resolutionNote, "resolutionNote must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        if (resolvedAt == null && !"SUBMITTED".equals(status)) {
            throw new IllegalArgumentException("resolvedAt is required once resolved");
        }
    }
}
