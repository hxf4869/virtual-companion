package com.virtualcompanion.platform.persistence;

import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/** Restricted S0-17 legal-hold mutations; SQL derives the actor from owner context. */
public final class RetentionLegalHoldService {

    private final JdbcTemplate jdbc;

    public RetentionLegalHoldService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public long set(long actingAccountId, long ownerUserId, String category, String reasonCode) {
        requirePositive(actingAccountId, "actingAccountId");
        requirePositive(ownerUserId, "ownerUserId");
        Objects.requireNonNull(category, "category must not be null");
        Objects.requireNonNull(reasonCode, "reasonCode must not be null");
        Long id = jdbc.queryForObject(
                "SELECT vc.set_retention_legal_hold_current(?, ?, ?)",
                Long.class,
                ownerUserId,
                category,
                reasonCode);
        if (id == null || id <= 0) {
            throw new IllegalStateException("set_retention_legal_hold_current returned no id");
        }
        return id;
    }

    public boolean release(long actingAccountId, long holdId) {
        requirePositive(actingAccountId, "actingAccountId");
        requirePositive(holdId, "holdId");
        Boolean released = jdbc.queryForObject(
                "SELECT vc.release_retention_legal_hold_current(?)",
                Boolean.class,
                holdId);
        return Boolean.TRUE.equals(released);
    }

    private static void requirePositive(long value, String name) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " must be positive");
        }
    }
}
