package com.virtualcompanion.runtime.auth.jwt;

import java.util.Objects;
import java.util.Optional;

/**
 * Durable access snapshot for one identity account (S0-30).
 *
 * <p>The JWT carries {@code sessionEpoch}; the filter re-reads this snapshot
 * on every authenticated request so a disable/logout/password bump is
 * observed before the next sensitive call. Missing or unreadable snapshots
 * fail closed.
 */
public record AccessSnapshot(String status, long sessionEpoch, String role) {

    public AccessSnapshot {
        Objects.requireNonNull(status, "status must not be null");
        if (status.isBlank()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        if (sessionEpoch < 1) {
            throw new IllegalArgumentException("sessionEpoch must be positive");
        }
        Objects.requireNonNull(role, "role must not be null");
    }

    public boolean allowsAccess(long presentedEpoch) {
        return "ACTIVE".equals(status) && sessionEpoch == presentedEpoch;
    }

    @FunctionalInterface
    public interface Authority {
        Optional<AccessSnapshot> find(long accountId);
    }
}
