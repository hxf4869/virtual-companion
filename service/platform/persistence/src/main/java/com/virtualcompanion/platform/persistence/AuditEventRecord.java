package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.identity_auth_event} audit row (V36 ADMIN-OPS).
 *
 * <p>{@code accountId} is the account the event is about; it is null only for
 * login failures that never resolved an account. {@code username} is the
 * normalized username recorded with the event.
 */
public record AuditEventRecord(
        long id,
        String eventType,
        Long accountId,
        String username,
        Instant occurredAt) {

    public AuditEventRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(eventType, "eventType must not be null");
        if (eventType.isBlank()) {
            throw new IllegalArgumentException("eventType must not be blank");
        }
        Objects.requireNonNull(username, "username must not be null");
        Objects.requireNonNull(occurredAt, "occurredAt must not be null");
    }
}
