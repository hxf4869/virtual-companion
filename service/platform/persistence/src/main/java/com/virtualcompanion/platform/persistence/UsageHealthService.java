package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Continuous-use reminder prefs and heartbeat over V52 SD functions
 * (§20.7 / 21.3.3). The backend computes continuous minutes; the client
 * only assists. Reminders are system-layer facts.
 */
public class UsageHealthService {

    public static final Set<Integer> APPROVED_REMINDER_MINUTES = Set.of(60, 90, 120, 180);
    public static final Set<Integer> APPROVED_GAP_MINUTES = Set.of(15, 30, 45);
    public static final Set<String> APPROVED_RESULTS = Set.of("SHOWN", "CONTINUED", "ENDED");

    private final JdbcTemplate jdbc;

    public UsageHealthService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public record UsageHealthStatus(
            int reminderAfterMinutes,
            int sessionGapMinutes,
            int continuousMinutes,
            boolean reminderDue,
            Instant sessionStartedAt) {
    }

    public static int requireReminderMinutes(Integer value) {
        if (value == null || !APPROVED_REMINDER_MINUTES.contains(value)) {
            throw new IllegalArgumentException("reminderAfterMinutes is not an approved interval");
        }
        return value;
    }

    public static int requireGapMinutes(Integer value) {
        if (value == null || !APPROVED_GAP_MINUTES.contains(value)) {
            throw new IllegalArgumentException("sessionGapMinutes is not an approved interval");
        }
        return value;
    }

    public static String requireResult(String result) {
        if (result == null || !APPROVED_RESULTS.contains(result)) {
            throw new IllegalArgumentException("usage reminder result is not approved");
        }
        return result;
    }

    public UsageHealthStatus get(long ownerUserId) {
        requireOwner(ownerUserId);
        return jdbc.query(
                "SELECT out_reminder_after_minutes, out_session_gap_minutes, "
                        + "out_continuous_minutes, out_reminder_due, out_session_started_at "
                        + "FROM vc.get_usage_health(?)",
                rowMapper(),
                ownerUserId).stream().findFirst().orElseThrow();
    }

    public UsageHealthStatus updatePrefs(
            long ownerUserId, int reminderAfterMinutes, int sessionGapMinutes) {
        requireOwner(ownerUserId);
        requireReminderMinutes(reminderAfterMinutes);
        requireGapMinutes(sessionGapMinutes);
        jdbc.queryForObject(
                "SELECT vc.update_usage_health_prefs(?, ?, ?)",
                Boolean.class,
                ownerUserId,
                reminderAfterMinutes,
                sessionGapMinutes);
        return get(ownerUserId);
    }

    public UsageHealthStatus heartbeat(long ownerUserId) {
        requireOwner(ownerUserId);
        return jdbc.query(
                "SELECT out_reminder_after_minutes, out_session_gap_minutes, "
                        + "out_continuous_minutes, out_reminder_due, out_session_started_at "
                        + "FROM vc.usage_heartbeat(?)",
                rowMapper(),
                ownerUserId).stream().findFirst().orElseThrow();
    }

    public UsageHealthStatus recordReminder(long ownerUserId, String result) {
        requireOwner(ownerUserId);
        String normalized = requireResult(result);
        jdbc.queryForObject(
                "SELECT vc.record_usage_reminder(?, ?)",
                Long.class,
                ownerUserId,
                normalized);
        return get(ownerUserId);
    }

    private static void requireOwner(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
    }

    private static RowMapper<UsageHealthStatus> rowMapper() {
        return (rs, rowNum) -> {
            Timestamp started = rs.getTimestamp("out_session_started_at");
            return new UsageHealthStatus(
                    rs.getInt("out_reminder_after_minutes"),
                    rs.getInt("out_session_gap_minutes"),
                    rs.getInt("out_continuous_minutes"),
                    rs.getBoolean("out_reminder_due"),
                    started == null ? null : started.toInstant());
        };
    }
}
