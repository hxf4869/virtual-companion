package com.virtualcompanion.platform.persistence;

import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/** Durable S0-16 deletion intent and cross-instance cancellation coordination. */
public final class AccountDeletionIntentService {

    private final JdbcTemplate jdbc;

    public AccountDeletionIntentService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public boolean requestCurrent(long ownerUserId) {
        requireOwner(ownerUserId);
        Boolean requested = jdbc.queryForObject(
                "SELECT vc.request_account_deletion_current()", Boolean.class);
        return Boolean.TRUE.equals(requested);
    }

    public boolean recordCancelSignalsCurrent(long ownerUserId, int count) {
        requireOwner(ownerUserId);
        if (count < 0) {
            throw new IllegalArgumentException("count must not be negative");
        }
        Boolean recorded = jdbc.queryForObject(
                "SELECT vc.record_account_deletion_cancel_signals_current(?)",
                Boolean.class,
                count);
        return Boolean.TRUE.equals(recorded);
    }

    public boolean activeCurrent(long ownerUserId) {
        requireOwner(ownerUserId);
        Boolean active = jdbc.queryForObject(
                "SELECT vc.account_deletion_intent_active_current()", Boolean.class);
        return Boolean.TRUE.equals(active);
    }

    public List<Long> cancellationTargets(int limit) {
        if (limit <= 0) {
            throw new IllegalArgumentException("limit must be positive");
        }
        return jdbc.query(
                "SELECT out_account_id FROM vc.list_account_deletion_cancellation_targets(?)",
                (rs, rowNum) -> rs.getLong("out_account_id"),
                limit);
    }

    private static void requireOwner(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
    }
}
