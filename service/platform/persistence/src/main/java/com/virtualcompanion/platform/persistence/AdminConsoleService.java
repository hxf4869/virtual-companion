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
