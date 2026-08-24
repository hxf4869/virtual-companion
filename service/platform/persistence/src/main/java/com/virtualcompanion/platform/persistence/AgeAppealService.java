package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Age-appeal persistence over the V56 SD functions (FR-AUTH-002 申诉入口).
 *
 * <p>Submission appends the appeal row and flips the effective age state to
 * AGE_APPEAL_PENDING in the same transaction; the caller pre-validates the
 * catalog transition (only ADULT_VERIFICATION_REQUIRED / MINOR_SUSPECTED can
 * appeal) and the SD re-asserts it as defense in depth. Reads are
 * owner-scoped and never disclose foreign rows.
 */
public class AgeAppealService {

    public static final int MAX_REASON_LENGTH = 500;
    private static final java.util.Set<String> RESOLUTION_DECISIONS = java.util.Set.of(
            "APPROVE_ADULT", "DENY_MINOR", "REVERIFY", "SUSPEND");
    static final String RESOLVE_SQL =
            "SELECT out_appeal_id, out_decision, out_age_state, out_resolved_at "
                    + "FROM vc.resolve_age_appeal(?, ?, ?, ?)";

    public record Resolution(
            long appealId, String decision, String ageState, java.time.Instant resolvedAt) {}

    private final JdbcTemplate jdbc;

    public AgeAppealService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Validate the appeal statement contract (exposed for the API layer). */
    public static String normalizeReason(String reason) {
        if (reason == null) {
            throw new IllegalArgumentException("reason must not be null");
        }
        String trimmed = reason.trim();
        if (trimmed.isEmpty() || trimmed.length() > MAX_REASON_LENGTH) {
            throw new IllegalArgumentException(
                    "reason must be 1.." + MAX_REASON_LENGTH + " trimmed characters");
        }
        return trimmed;
    }

    /**
     * Append one appeal and flip the effective state to AGE_APPEAL_PENDING.
     * Returns the new appeal id. The SD raises when the current state cannot
     * appeal (the runtime pre-validates the same rule and maps it to 400).
     */
    public long submit(long ownerUserId, String reason) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        String normalized = normalizeReason(reason);
        Long id = jdbc.queryForObject(
                "SELECT vc.submit_age_appeal(?, ?)",
                Long.class,
                ownerUserId,
                normalized);
        if (id == null || id <= 0) {
            throw new IllegalStateException("submit_age_appeal returned no id");
        }
        return id;
    }

    public Resolution resolve(
            long actingAccountId, long appealId, String decision, String resolutionNote) {
        if (actingAccountId <= 0 || appealId <= 0) {
            throw new IllegalArgumentException("actor and appeal ids must be positive");
        }
        if (decision == null || !RESOLUTION_DECISIONS.contains(decision)) {
            throw new IllegalArgumentException("unsupported age appeal decision");
        }
        String note = resolutionNote == null ? "" : resolutionNote.trim();
        if (note.isEmpty() || note.length() > 240) {
            throw new IllegalArgumentException("resolutionNote must be 1..240 trimmed characters");
        }
        return jdbc.query(
                RESOLVE_SQL,
                (rs, rowNum) -> new Resolution(
                        rs.getLong("out_appeal_id"),
                        rs.getString("out_decision"),
                        rs.getString("out_age_state"),
                        rs.getTimestamp("out_resolved_at").toInstant()),
                actingAccountId, appealId, decision, note)
                .stream().findFirst().orElseThrow(() ->
                        new IllegalStateException("resolve_age_appeal returned no row"));
    }

    /**
     * Keyset page of the owner's appeals, newest first (after = last id
     * seen). A null limit defers to the SD default (20, clamped to [1, 50]).
     */
    public List<AgeAppealRecord> list(long ownerUserId, Long after, Integer limit) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_reason, out_status, out_resolution_note, "
                        + "out_created_at, out_resolved_at "
                        + "FROM vc.list_age_appeals(?, ?, ?)",
                rowMapper(),
                ownerUserId,
                after,
                limit);
    }

    private static RowMapper<AgeAppealRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new AgeAppealRecord(
                rs.getLong("out_id"),
                rs.getString("out_reason"),
                rs.getString("out_status"),
                nullToEmpty(rs.getString("out_resolution_note")),
                rs.getTimestamp("out_created_at").toInstant(),
                nullableInstant(rs, "out_resolved_at"));
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }

    private static java.time.Instant nullableInstant(ResultSet rs, String column)
            throws java.sql.SQLException {
        java.sql.Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }
}
