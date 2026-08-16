package com.virtualcompanion.platform.persistence;

import java.util.Objects;

/**
 * One {@code vc.generation} row.
 *
 * <p>{@code logicalGenerationId} is the stable id for a logical request
 * (INV-GEN-001): retries, fallbacks and model switches reuse it rather than
 * minting a new one. {@code idempotencyKey} is the client-supplied per-owner
 * dedup handle that {@code vc.receive_generation} uses to resolve a retry back
 * to the same row; it is {@code null} for receptions that carry no dedup handle.
 *
 * <p>The lifecycle status is stored as text (the catalog {@code GenerationState}
 * code) so this persistence skeleton does not depend on the generated catalog
 * types. {@code CREATED} is the value written on first reception.
 *
 * <p>CHAT-MODE: {@code mode} is the turn-level interaction mode captured at
 * reception ({@code AUTO}, {@code LISTEN} or {@code DISCUSS}; V34). It is
 * frozen on the first reception and never rewritten by an idempotent rejoin.
 */
public record GenerationRecord(
        long ownerUserId,
        long id,
        long conversationId,
        String logicalGenerationId,
        String status,
        String idempotencyKey,
        String mode) {

    /** CHAT-MODE: default mode when a caller omits it ({@code AUTO}). */
    public static final String DEFAULT_MODE = "AUTO";

    /** Legacy 6-arg construction defaults the mode to {@code AUTO}. */
    public GenerationRecord(
            long ownerUserId,
            long id,
            long conversationId,
            String logicalGenerationId,
            String status,
            String idempotencyKey) {
        this(ownerUserId, id, conversationId, logicalGenerationId, status, idempotencyKey, DEFAULT_MODE);
    }

    public GenerationRecord {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        if (conversationId <= 0) {
            throw new IllegalArgumentException("conversationId must be positive");
        }
        Objects.requireNonNull(logicalGenerationId, "logicalGenerationId must not be null");
        if (logicalGenerationId.isBlank()) {
            throw new IllegalArgumentException("logicalGenerationId must not be blank");
        }
        Objects.requireNonNull(status, "status must not be null");
        if (status.isBlank()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        if (idempotencyKey != null && idempotencyKey.isBlank()) {
            throw new IllegalArgumentException("idempotencyKey must not be blank");
        }
        if (mode == null || mode.isBlank()) {
            throw new IllegalArgumentException("mode must not be blank");
        }
    }
}
