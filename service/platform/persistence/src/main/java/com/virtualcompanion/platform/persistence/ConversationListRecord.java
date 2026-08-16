package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One conversation list row surfaced by the V30
 * {@code vc.list_conversations} SECURITY DEFINER function (CONV-HIST).
 *
 * <p>The last-message preview ({@code lastMessageRole} /
 * {@code lastMessagePreview}) is {@code null} for a conversation that has no
 * messages; the preview content is clamped by the SD (200 chars) and is a
 * display convenience, never a substitute for {@code list_messages}.
 */
public record ConversationListRecord(
        long id,
        long relationshipId,
        Instant createdAt,
        String lastMessageRole,
        String lastMessagePreview) {

    public ConversationListRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        Objects.requireNonNull(createdAt, "createdAt must not be null");
    }
}
