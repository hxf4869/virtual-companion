package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.reminder} row (V39, FR-NOTIFY-001).
 *
 * <p>A reminder is a STRUCTURED record — the companion model never encodes a
 * "remind me later" instruction inside a prompt. {@code remindAt} is a UTC
 * instant; {@code recurrence} is {@code NONE}, {@code DAILY} or
 * {@code WEEKLY}; {@code status} is {@code ACTIVE} or {@code DISMISSED}.
 * Technical Alpha stores and lists reminders without any push transport
 * (product-scope: 不提供主动消息).
 */
public record ReminderRecord(
        long id,
        long relationshipId,
        String text,
        Instant remindAt,
        String recurrence,
        String status,
        Instant createdAt,
        Instant updatedAt) {

    public ReminderRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        Objects.requireNonNull(text, "text must not be null");
        if (text.isBlank() || text.length() > 500) {
            throw new IllegalArgumentException("text must be 1..500 characters");
        }
        Objects.requireNonNull(remindAt, "remindAt must not be null");
        Objects.requireNonNull(recurrence, "recurrence must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(createdAt, "createdAt must not be null");
        Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    }
}
