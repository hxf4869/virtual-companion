package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Minimal internal admin console reads over the V36 ADMIN-only SECURITY
 * DEFINER functions (ADMIN-OPS / B0-005 slice).
 *
 * <p>Both reads re-verify in SQL that the acting account is an ACTIVE ADMIN —
 * the API layer's role claim alone is never trusted (V31 pattern). A
 * non-ADMIN caller RAISEs inside the SD function; the runtime maps that to the
 * generic non-disclosing admin surface.
 */
public class AdminConsoleService {

    /** ADMIN-OPS: default usage window in days (mirrors the SD default). */
    public static final int DEFAULT_USAGE_DAYS = 14;

    /** ADMIN-OPS: usage window clamp band. */
    public static final int MIN_USAGE_DAYS = 1;
    public static final int MAX_USAGE_DAYS = 90;

    private final JdbcTemplate jdbc;

    public AdminConsoleService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * ADMIN-OPS: keyset page of the audit trail, newest first.
     *
     * @param after the last event id seen (exclusive); null starts from the newest
     * @param limit page size, clamped server-side to 1..200
     */
    public List<AuditEventRecord> listAuditEvents(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_event_type, out_account_id, out_username, out_occurred_at "
                        + "FROM vc.identity_auth_event_list(?, ?, ?)",
                (rs, rowNum) -> new AuditEventRecord(
                        rs.getLong("out_id"),
                        rs.getString("out_event_type"),
                        (Long) rs.getObject("out_account_id"),
                        rs.getString("out_username"),
                        rs.getTimestamp("out_occurred_at").toInstant()),
                actingAccountId,
                after,
                limit);
    }

    /**
     * ADMIN-OPS: per-day usage/cost aggregates since the window floor,
     * newest day first.
     *
     * @param days window length, clamped to 1..90
     */
    public List<UsageSummaryRecord> usageSummary(long actingAccountId, int days) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        int clamped = Math.clamp(days, MIN_USAGE_DAYS, MAX_USAGE_DAYS);
        Instant since = Instant.now().minus(java.time.Duration.ofDays(clamped));
        return jdbc.query(
                "SELECT out_day, out_generations, out_input_tokens, out_output_tokens, out_cost "
                        + "FROM vc.admin_usage_summary(?, ?)",
                (rs, rowNum) -> new UsageSummaryRecord(
                        rs.getDate("out_day").toLocalDate(),
                        rs.getLong("out_generations"),
                        rs.getLong("out_input_tokens"),
                        rs.getLong("out_output_tokens"),
                        rs.getBigDecimal("out_cost")),
                actingAccountId,
                java.sql.Timestamp.from(since));
    }

    /**
     * SAFETY-QUEUE (V59): keyset page of the deterministic safety queue
     * across all owners, newest first. Read-only — triage and disposition
     * stay human actions outside the API.
     *
     * @param after the last event id seen (exclusive); null starts from the newest
     * @param limit page size, clamped server-side to 1..200
     */
    public List<SafetyEventListRecord> listSafetyEvents(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_generation_id, out_stage, "
                        + "out_risk_level, out_rule_id, out_created_at "
                        + "FROM vc.list_safety_events(?, ?, ?)",
                (rs, rowNum) -> new SafetyEventListRecord(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        (Long) rs.getObject("out_generation_id"),
                        rs.getString("out_stage"),
                        rs.getString("out_risk_level"),
                        rs.getString("out_rule_id"),
                        rs.getTimestamp("out_created_at").toInstant()),
                actingAccountId,
                after,
                limit);
    }

    /** ADMIN-BETA (V64): one report queue row. */
    public record ReportQueueRow(
            long id, long ownerId, Long messageId, String reason, String note,
            String status, Instant createdAt) {
    }

    /** ADMIN-BETA (V64): one age-appeal queue row. */
    public record AgeAppealQueueRow(
            long id, long ownerId, String reason, String status, Instant createdAt) {
    }

    /** ADMIN-BETA (V64): one export-task queue row. */
    public record ExportTaskRow(
            long id, long ownerId, String status, Instant createdAt, Instant completedAt) {
    }

    /** ADMIN-BETA (V64): one memory-anomaly sampling row. */
    public record MemorySamplingRow(
            long id, long ownerId, long relationshipId, String scope, String summary,
            String status, Instant deletedAt, Instant createdAt) {
    }

    /** ADMIN-BETA (V64): the report/complaint intake queue, newest first. */
    public List<ReportQueueRow> listReports(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_message_id, out_reason, "
                        + "out_note, out_status, out_created_at "
                        + "FROM vc.admin_list_reports(?, ?, ?)",
                (rs, rowNum) -> new ReportQueueRow(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        (Long) rs.getObject("out_message_id"),
                        rs.getString("out_reason"),
                        rs.getString("out_note"),
                        rs.getString("out_status"),
                        rs.getTimestamp("out_created_at").toInstant()),
                actingAccountId, after, limit);
    }

    /** ADMIN-BETA (V64): the age-appeal intake queue, newest first. */
    public List<AgeAppealQueueRow> listAgeAppeals(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_reason, out_status, out_created_at "
                        + "FROM vc.admin_list_age_appeals(?, ?, ?)",
                (rs, rowNum) -> new AgeAppealQueueRow(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        rs.getString("out_reason"),
                        rs.getString("out_status"),
                        rs.getTimestamp("out_created_at").toInstant()),
                actingAccountId, after, limit);
    }

    /** ADMIN-BETA (V64): the async export-task queue, newest first. */
    public List<ExportTaskRow> listExportTasks(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_status, out_created_at, "
                        + "out_completed_at FROM vc.admin_list_export_tasks(?, ?, ?)",
                (rs, rowNum) -> new ExportTaskRow(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        rs.getString("out_status"),
                        rs.getTimestamp("out_created_at").toInstant(),
                        rs.getTimestamp("out_completed_at") == null
                                ? null : rs.getTimestamp("out_completed_at").toInstant()),
                actingAccountId, after, limit);
    }

    /** ADMIN-BETA (V64): memory-anomaly sampling (non-ACCEPTED or deleted). */
    public List<MemorySamplingRow> memorySampling(long actingAccountId, Long after, int limit) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_owner_user_id, out_relationship_id, out_scope, "
                        + "out_summary, out_status, out_deleted_at, out_created_at "
                        + "FROM vc.admin_memory_sampling(?, ?, ?)",
                (rs, rowNum) -> new MemorySamplingRow(
                        rs.getLong("out_id"),
                        rs.getLong("out_owner_user_id"),
                        rs.getLong("out_relationship_id"),
                        rs.getString("out_scope"),
                        rs.getString("out_summary"),
                        rs.getString("out_status"),
                        rs.getTimestamp("out_deleted_at") == null
                                ? null : rs.getTimestamp("out_deleted_at").toInstant(),
                        rs.getTimestamp("out_created_at").toInstant()),
                actingAccountId, after, limit);
    }

    /** SAFETY-QUEUE: one admin-queue row (V59). */
    public record SafetyEventListRecord(
            long id,
            long ownerUserId,
            Long generationId,
            String stage,
            String riskLevel,
            String ruleId,
            Instant createdAt) {
    }
}
