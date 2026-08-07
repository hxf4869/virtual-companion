package com.virtualcompanion.platform.persistence;

import java.time.OffsetDateTime;

/**
 * Durable identity account row (V14 {@code vc.identity_account}). Platform-level
 * management object -- NOT owner-scoped business data: its {@code id} IS the
 * {@code owner_user_id} the runtime derives for RLS (INV-TENANT-001), and it
 * always corresponds to a real {@code vc.vc_user} ownership root.
 *
 * <p>The password hash is a BCrypt hash; it is returned by
 * {@code vc.identity_authenticate} so the runtime can compare it with the
 * presented credential using Spring Security's BCrypt encoder. Neither the raw
 * password nor a plaintext token is ever stored here.
 */
public record IdentityAccountRecord(
        long id,
        String username,
        String passwordHash,
        String role,
        String status,
        String displayName,
        OffsetDateTime createdAt) {

    public IdentityAccountRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("username is required");
        }
        if (passwordHash == null || passwordHash.isBlank()) {
            throw new IllegalArgumentException("passwordHash is required");
        }
        if (role == null || role.isBlank()) {
            throw new IllegalArgumentException("role is required");
        }
        if (status == null || status.isBlank()) {
            throw new IllegalArgumentException("status is required");
        }
    }
}
