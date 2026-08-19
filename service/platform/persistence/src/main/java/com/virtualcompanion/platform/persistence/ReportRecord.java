package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.report_request} row (V56, FR-DATA-001 / §20.15).
 *
 * <p>A report is an append-only intake record: SUBMITTED from the moment the
 * user submits it, RESOLVED only through human review. The optional message
 * anchor becomes null when the anchored message is later deleted, while the
 * intake record survives.
 */
public record ReportRecord(
        long id,
        Long messageId,
        String reason,
        String note,
        String status,
        String resolutionNote,
        Instant createdAt,
        Instant resolvedAt) {

    public ReportRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        if (messageId != null && messageId <= 0) {
            throw new IllegalArgumentException("messageId must be positive when present");
        }
        Objects.requireNonNull(reason, "reason must not be null");
        if (reason.isBlank()) {
            throw new IllegalArgumentException("reason must not be blank");
        }
        Objects.requireNonNull(note, "note must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(resolutionNote, "resolutionNote must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        if (resolvedAt == null && !"SUBMITTED".equals(status)) {
            throw new IllegalArgumentException("resolvedAt is required once resolved");
        }
    }
}
