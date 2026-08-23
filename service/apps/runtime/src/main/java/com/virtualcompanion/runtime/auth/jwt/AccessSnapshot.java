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

    /**
     * S0-30: the presented token is valid only when the account is ACTIVE,
     * the session epoch matches (disable/logout/password-change bump) and the
     * granted role still equals the snapshot role — a demotion (降权) without
     * an epoch bump therefore fails closed on the next authenticated request
     * instead of riding a long-lived JWT.
     */
    public boolean allowsAccess(long presentedEpoch, String presentedRole) {
        return "ACTIVE".equals(status)
                && sessionEpoch == presentedEpoch
                && role.equals(presentedRole);
    }

    @FunctionalInterface
    public interface Authority {
        Optional<AccessSnapshot> find(long accountId);
    }
}
