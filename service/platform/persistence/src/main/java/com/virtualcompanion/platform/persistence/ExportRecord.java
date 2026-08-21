package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.export_request} status row (V42, FR-DATA-002).
 *
 * <p>{@code status} is {@code PENDING} (work item enqueued), {@code READY}
 * (payload sealed with a short-lived one-time token), {@code FAILED} or
 * {@code EXPIRED} (payload purged after expiry). No download token here: the
 * one-time secret exists only in the create response (its sha256 digest is
 * what the row stores, V76). The payload itself is never part of this record
 * — only {@link ExportService#consume} returns it, exactly once.
 */
public record ExportRecord(
        long id,
        String status,
        Instant requestedAt,
        Instant completedAt,
        Instant expiresAt,
        String errorMessage) {

    public ExportRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(status, "status must not be null");
        if (status.isBlank()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        Objects.requireNonNull(requestedAt, "requestedAt must not be null");
    }
}
