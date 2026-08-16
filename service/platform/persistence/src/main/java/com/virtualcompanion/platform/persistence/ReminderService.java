package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Structured reminder persistence over the V39 SECURITY DEFINER functions
 * (FR-NOTIFY-001).
 *
 * <p>All access is owner-scoped and re-verified in SQL (V17 trusted-owner
 * pattern); runtime roles hold no table grants. Eager validation rejects
 * unapproved recurrence/status codes and over-long text with a 400 at the API
 * layer; the SD functions raise identically as defense in depth for direct
 * callers. A foreign or absent reminder returns empty / false so existence is
 * never disclosed.
 */
public class ReminderService {

    public static final String RECURRENCE_NONE = "NONE";
    public static final String RECURRENCE_DAILY = "DAILY";
    public static final String RECURRENCE_WEEKLY = "WEEKLY";
    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_DISMISSED = "DISMISSED";

    private static final Set<String> APPROVED_RECURRENCES =
            Set.of(RECURRENCE_NONE, RECURRENCE_DAILY, RECURRENCE_WEEKLY);
    private static final Set<String> APPROVED_STATUSES =
            Set.of(STATUS_ACTIVE, STATUS_DISMISSED);

    public static final int MAX_TEXT_LENGTH = 500;

    private final JdbcTemplate jdbc;

    public ReminderService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** FR-NOTIFY-001: narrow a caller-supplied recurrence (fail closed). */
    public static String normalizeRecurrence(String recurrence) {
        if (recurrence == null || recurrence.isBlank()) {
            return RECURRENCE_NONE;
        }
        if (!APPROVED_RECURRENCES.contains(recurrence)) {
            throw new IllegalArgumentException(
                    "recurrence must be one of NONE, DAILY, WEEKLY: " + recurrence);
        }
        return recurrence;
    }

    /** FR-NOTIFY-001: narrow a caller-supplied status (fail closed). */
    public static String normalizeStatus(String status) {
        if (status == null || status.isBlank()) {
            throw new IllegalArgumentException("status must not be blank");
        }
        if (!APPROVED_STATUSES.contains(status)) {
            throw new IllegalArgumentException(
                    "status must be ACTIVE or DISMISSED: " + status);
        }
        return status;
    }

    /** Validate the shared text/instant contract (exposed for unit tests). */
    static void validateTextAndInstant(String text, Instant remindAt) {
        if (text == null || text.isBlank() || text.length() > MAX_TEXT_LENGTH) {
            throw new IllegalArgumentException("text must be 1.." + MAX_TEXT_LENGTH + " characters");
        }
        Objects.requireNonNull(remindAt, "remindAt must not be null");
    }

    /** Create a reminder under the owner's relationship. Returns the new id. */
    public long create(
            long ownerUserId,
            long relationshipId,
            String text,
            Instant remindAt,
            String recurrence) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        validateTextAndInstant(text, remindAt);
        String normalizedRecurrence = normalizeRecurrence(recurrence);
        Long id = jdbc.queryForObject(
                "SELECT vc.create_reminder(?, ?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                relationshipId,
                text.trim(),
                Timestamp.from(remindAt),
                normalizedRecurrence);
        if (id == null || id <= 0) {
            throw new IllegalStateException("create_reminder returned no id");
        }
        return id;
    }

    /** Read one owned reminder (empty for a foreign or absent id). */
    public Optional<ReminderRecord> get(long ownerUserId, long reminderId) {
        if (ownerUserId <= 0 || reminderId <= 0) {
            return Optional.empty();
        }
        return jdbc.query(
                "SELECT out_id, out_relationship_id, out_text, out_remind_at, "
                        + "out_recurrence, out_status, out_created_at, out_updated_at "
                        + "FROM vc.get_reminder(?, ?)",
                rowMapper(),
                ownerUserId,
                reminderId).stream().findFirst();
    }

    /** Keyset page of a relationship's reminders, soonest first. */
    public List<ReminderRecord> list(
            long ownerUserId, Long relationshipId, Long afterId, Integer limit) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (relationshipId != null && relationshipId <= 0) {
            throw new IllegalArgumentException("relationshipId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_relationship_id, out_text, out_remind_at, "
                        + "out_recurrence, out_status, out_created_at, out_updated_at "
                        + "FROM vc.list_reminders(?, ?, ?, ?)",
                rowMapper(),
                ownerUserId,
                relationshipId,
                afterId,
                limit);
    }

    /**
     * Update every field of an owned reminder (no partial silent edits).
     *
     * @return the updated row, or empty for a foreign or absent id
     */
    public Optional<ReminderRecord> update(
            long ownerUserId,
            long reminderId,
            String text,
            Instant remindAt,
            String recurrence,
            String status) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (reminderId <= 0) {
            throw new IllegalArgumentException("reminderId must be positive");
        }
        validateTextAndInstant(text, remindAt);
        String normalizedRecurrence = normalizeRecurrence(recurrence);
        String normalizedStatus = normalizeStatus(status);
        Boolean updated = jdbc.queryForObject(
                "SELECT vc.update_reminder(?, ?, ?, ?, ?, ?)",
                Boolean.class,
                ownerUserId,
                reminderId,
                text.trim(),
                Timestamp.from(remindAt),
                normalizedRecurrence,
                normalizedStatus);
        if (!Boolean.TRUE.equals(updated)) {
            return Optional.empty();
        }
        return get(ownerUserId, reminderId);
    }

    /** Delete an owned reminder (false for a foreign or absent id). */
    public boolean delete(long ownerUserId, long reminderId) {
        if (ownerUserId <= 0 || reminderId <= 0) {
            return false;
        }
        Boolean deleted = jdbc.queryForObject(
                "SELECT vc.delete_reminder(?, ?)",
                Boolean.class,
                ownerUserId,
                reminderId);
        return Boolean.TRUE.equals(deleted);
    }

    private static RowMapper<ReminderRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new ReminderRecord(
                rs.getLong("out_id"),
                rs.getLong("out_relationship_id"),
                rs.getString("out_text"),
                rs.getTimestamp("out_remind_at").toInstant(),
                rs.getString("out_recurrence"),
                rs.getString("out_status"),
                rs.getTimestamp("out_created_at").toInstant(),
                rs.getTimestamp("out_updated_at").toInstant());
    }
}
