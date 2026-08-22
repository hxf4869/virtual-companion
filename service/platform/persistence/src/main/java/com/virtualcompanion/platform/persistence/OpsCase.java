package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Frozen S0-14-A ops-case envelope. Intake rows stay on report/safety/appeal;
 * this table never stores chat body. {@code slaHours} null means no promise.
 */
public final class OpsCase {

    static final String OPEN_SQL =
            "SELECT out_id, out_inserted FROM vc.open_ops_case(?, ?, ?, ?, ?)";
    static final String LIST_SQL =
            "SELECT out_id, out_kind, out_source_owner_user_id, out_source_id, out_status,"
                    + " out_severity, out_sla_hours, out_assignee_account_id,"
                    + " out_disposition_reason, out_public_note, out_opened_at"
                    + " FROM vc.list_ops_cases(?, ?, ?)";
    static final String TRANSITION_SQL =
            "SELECT out_id, out_status FROM vc.transition_ops_case(?, ?, ?, ?, ?)";
    static final String SNAPSHOT_SQL =
            "SELECT out_id, out_kind, out_source_owner_user_id, out_source_id, out_status,"
                    + " out_severity, out_sla_hours, out_assignee_account_id,"
                    + " out_disposition_reason, out_public_note, out_opened_at"
                    + " FROM vc.ops_case_snapshot(?, ?)";

    public record OpenResult(long id, boolean inserted) {
    }

    public record TransitionResult(long id, String status) {
    }

    public record Snapshot(
            long id,
            String kind,
            long sourceOwnerUserId,
            long sourceId,
            String status,
            String severity,
            Integer slaHours,
            Long assigneeAccountId,
            String dispositionReason,
            String publicNote,
            Instant openedAt) {
    }

    private final JdbcTemplate jdbc;

    public OpsCase(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public OpenResult open(
            long actingAccountId, String kind, long sourceOwnerUserId, long sourceId, String severity) {
        if (actingAccountId <= 0 || sourceOwnerUserId <= 0 || sourceId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        Objects.requireNonNull(kind, "kind must not be null");
        Objects.requireNonNull(severity, "severity must not be null");
        return jdbc.query(
                OPEN_SQL,
                (rs, rowNum) -> new OpenResult(
                        rs.getLong("out_id"),
                        rs.getBoolean("out_inserted")),
                actingAccountId,
                kind,
                sourceOwnerUserId,
                sourceId,
                severity).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("open_ops_case returned no row"));
    }

    public TransitionResult transition(
            long actingAccountId,
            long caseId,
            String action,
            Long assigneeAccountId,
            String dispositionReason) {
        if (actingAccountId <= 0 || caseId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        Objects.requireNonNull(action, "action must not be null");
        return jdbc.query(
                TRANSITION_SQL,
                (rs, rowNum) -> new TransitionResult(
                        rs.getLong("out_id"),
                        rs.getString("out_status")),
                actingAccountId,
                caseId,
                action,
                assigneeAccountId,
                dispositionReason).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("transition_ops_case returned no row"));
    }

    public java.util.List<Snapshot> list(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        return jdbc.query(
                LIST_SQL,
                (rs, rowNum) -> mapSnapshot(rs),
                actingAccountId,
                after,
                limit);
    }

    public Snapshot snapshot(long actingAccountId, long caseId) {
        if (actingAccountId <= 0 || caseId <= 0) {
            throw new IllegalArgumentException("ids must be positive");
        }
        return jdbc.query(
                SNAPSHOT_SQL,
                (rs, rowNum) -> mapSnapshot(rs),
                actingAccountId,
                caseId).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("ops_case_snapshot returned no row"));
    }

    private static Snapshot mapSnapshot(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new Snapshot(
                rs.getLong("out_id"),
                rs.getString("out_kind"),
                rs.getLong("out_source_owner_user_id"),
                rs.getLong("out_source_id"),
                rs.getString("out_status"),
                rs.getString("out_severity"),
                (Integer) rs.getObject("out_sla_hours"),
                (Long) rs.getObject("out_assignee_account_id"),
                rs.getString("out_disposition_reason"),
                rs.getString("out_public_note"),
                rs.getTimestamp("out_opened_at").toInstant());
    }
}
