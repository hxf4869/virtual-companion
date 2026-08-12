package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.message} row surfaced by the V10 {@code vc.list_messages}
 * SECURITY DEFINER function (TASK-0179).
 *
 * <p>Maps the {@code out_id / out_role / out_content / out_created_at} output
 * columns. The owning conversation id is carried by the HTTP path and is not
 * part of the SD output columns.
 */
public record MessageHistoryRecord(long id, String role, String content, Instant createdAt) {

    public MessageHistoryRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(role, "role must not be null");
        if (role.isBlank()) {
            throw new IllegalArgumentException("role must not be blank");
        }
        Objects.requireNonNull(content, "content must not be null");
        if (createdAt == null) {
            throw new IllegalArgumentException("createdAt must not be null");
        }
    }
}
