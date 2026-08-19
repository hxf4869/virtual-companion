package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Report intake persistence over the V56 SD functions (FR-DATA-001 举报和
 * 申诉状态, §20.15 投诉申诉和误判).
 *
 * <p>All access is owner-scoped and re-verified in SQL (V17 trusted-owner
 * pattern). Eager validation rejects unapproved reasons (report-reasons
 * catalog) and oversized notes with a 400 at the API layer; the SD raises
 * identically as defense in depth. A foreign or absent message anchor
 * returns an empty create so existence is never disclosed (the controller
 * maps it to NOT_FOUND_OR_FORBIDDEN).
 */
public class ReportService {

    public static final int MAX_NOTE_LENGTH = 2000;

    private static final Set<String> APPROVED_REASONS = Set.of(
            "UNSAFE_CONTENT", "AI_IDENTITY", "MINOR_SAFEGUARD",
            "PRIVACY_OR_DATA", "OTHER");

    private final JdbcTemplate jdbc;

    public ReportService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** FR-DATA-001: narrow a caller-supplied reason to the catalog (fail closed). */
    public static String normalizeReason(String reason) {
        if (reason == null || !APPROVED_REASONS.contains(reason)) {
            throw new IllegalArgumentException(
                    "reason must be a report-reasons catalog code: " + reason);
        }
        return reason;
    }

    /** Validate the free-text note contract (exposed for the API layer). */
    public static String normalizeNote(String note) {
        if (note == null) {
            throw new IllegalArgumentException("note must not be null");
        }
        String trimmed = note.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_NOTE_LENGTH) {
            throw new IllegalArgumentException(
                    "note must be 1.." + MAX_NOTE_LENGTH + " trimmed characters");
        }
        return trimmed;
    }

    /**
     * Append one report. A non-null message anchor that is absent or foreign
     * yields empty (existence never disclosed); otherwise the new report id.
     */
    public java.util.OptionalLong create(
            long ownerUserId, Long messageId, String reason, String note) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (messageId != null && messageId <= 0) {
            throw new IllegalArgumentException("messageId must be positive when present");
        }
        String normalizedReason = normalizeReason(reason);
        String normalizedNote = normalizeNote(note);
        Long id = jdbc.queryForObject(
                "SELECT vc.create_report(?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                messageId,
                normalizedReason,
                normalizedNote);
        if (id == null) {
            throw new IllegalStateException("create_report returned no row");
        }
        return id <= 0
                ? java.util.OptionalLong.empty()
                : java.util.OptionalLong.of(id);
    }

    /** Read one owned report (empty for a foreign or absent id). */
    public java.util.Optional<ReportRecord> get(long ownerUserId, long reportId) {
        if (ownerUserId <= 0 || reportId <= 0) {
            return java.util.Optional.empty();
        }
        return jdbc.query(
                "SELECT out_id, out_message_id, out_reason, out_note, out_status, "
                        + "out_resolution_note, out_created_at, out_resolved_at "
                        + "FROM vc.get_report(?, ?)",
                rowMapper(),
                ownerUserId,
                reportId).stream().findFirst();
    }

    /**
     * Keyset page of the owner's reports, newest first (after = last id
     * seen). A null limit defers to the SD default (20, clamped to [1, 50]).
     */
    public List<ReportRecord> list(long ownerUserId, Long after, Integer limit) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_message_id, out_reason, out_note, out_status, "
                        + "out_resolution_note, out_created_at, out_resolved_at "
                        + "FROM vc.list_reports(?, ?, ?)",
                rowMapper(),
                ownerUserId,
                after,
                limit);
    }

    private static RowMapper<ReportRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new ReportRecord(
                rs.getLong("out_id"),
                (Long) rs.getObject("out_message_id"),
                rs.getString("out_reason"),
                rs.getString("out_note"),
                rs.getString("out_status"),
                nullToEmpty(rs.getString("out_resolution_note")),
                rs.getTimestamp("out_created_at").toInstant(),
                nullableInstant(rs));
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static Instant nullableInstant(ResultSet rs)
            throws java.sql.SQLException {
        Timestamp ts = rs.getTimestamp("out_resolved_at");
        return ts == null ? null : ts.toInstant();
    }
}
