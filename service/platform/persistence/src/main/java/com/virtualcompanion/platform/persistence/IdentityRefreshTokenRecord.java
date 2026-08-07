package com.virtualcompanion.platform.persistence;

import java.time.OffsetDateTime;

/**
 * Durable refresh-session row (V14 {@code vc.identity_refresh_token}). Only the
 * sha256 hex hash of the raw token is stored; the raw token is returned to the
 * client once at issue time and never reaches the database, logs or model.
 *
 * <p>A session is live while {@code revokedAt} is {@code null} and
 * {@code expiresAt} is in the future. The server keeps state so logout can
 * revoke a session and refresh validates it before renewal.
 */
public record IdentityRefreshTokenRecord(
        long id,
        long accountId,
        String tokenHash,
        OffsetDateTime expiresAt,
        OffsetDateTime revokedAt,
        OffsetDateTime createdAt) {

    public IdentityRefreshTokenRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        if (accountId <= 0) {
            throw new IllegalArgumentException("accountId must be positive");
        }
        if (tokenHash == null || tokenHash.isBlank()) {
            throw new IllegalArgumentException("tokenHash is required");
        }
        if (expiresAt == null) {
            throw new IllegalArgumentException("expiresAt is required");
        }
    }
}
