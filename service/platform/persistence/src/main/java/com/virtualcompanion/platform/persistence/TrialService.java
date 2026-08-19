package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Simulated trial grants over the V61 SD functions (ENT-TRIAL / FR-ENT-005).
 *
 * <p>ADMIN grants one live per-owner trial (a PREMIUM turn budget with an
 * expiry); the mint consumes one turn per NEW generation. A spent or expired
 * trial falls back to the ADMIN assignment (or ECONOMY) — trials never touch
 * chats, memories or relationships. All access is owner/admin scoped and
 * re-verified in SQL.
 */
public class TrialService {

    /** The owner's live trial state (empty when no active grant). */
    public record TrialStatus(long id, int remainingTurns, Instant expiresAt) {
    }

    private final JdbcTemplate jdbc;

    public TrialService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** ADMIN grants a trial; a previous ACTIVE grant is replaced. Returns the id. */
    public long grant(long adminAccountId, long ownerUserId, int turns, int days) {
        if (adminAccountId <= 0 || ownerUserId <= 0) {
            throw new IllegalArgumentException("account ids must be positive");
        }
        if (turns < 1 || turns > 1000) {
            throw new IllegalArgumentException("turns must be 1..1000");
        }
        if (days < 1 || days > 90) {
            throw new IllegalArgumentException("days must be 1..90");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.grant_trial(?, ?, ?, ?)",
                Long.class,
                adminAccountId,
                ownerUserId,
                turns,
                days);
        if (id == null || id <= 0) {
            throw new IllegalStateException("grant_trial returned no id");
        }
        return id;
    }

    /** The caller's live trial (empty when none). */
    public Optional<TrialStatus> status(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        List<TrialStatus> rows = jdbc.query(
                "SELECT out_id, out_remaining_turns, out_expires_at "
                        + "FROM vc.trial_status(?)",
                (rs, rowNum) -> new TrialStatus(
                        rs.getLong("out_id"),
                        rs.getInt("out_remaining_turns"),
                        rs.getTimestamp("out_expires_at").toInstant()),
                ownerUserId);
        return rows.stream().findFirst();
    }

    /** Exposed for callers formatting the expiry (keeps Timestamp handling here). */
    static Timestamp toTimestamp(Instant instant) {
        return Timestamp.from(instant);
    }
}
