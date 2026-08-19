package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Quota-ledger reconciliation and the persisted provider registry over the
 * V61 SD functions (QUOTA-PERSIST / §12.4、§12.26).
 *
 * <p>The reconciliation compares quota_ledger_entry rows against generation
 * terminal states over a window: settled/released volumes plus three anomaly
 * classes (settled-but-not-completed, completed-but-unsettled,
 * failed-without-release). ADMIN-only, re-verified in SQL. The registry read
 * exposes the persisted deployment table (V4) — admission states are the
 * durable source of truth for routing eligibility, never in-memory config.
 */
public class QuotaReconciliationService {

    /** Default reconciliation window (mirrors the SD default). */
    public static final int DEFAULT_WINDOW_DAYS = 14;

    /** One reconciliation result row. */
    public record Reconciliation(
            long settledCount, long settledAmount,
            long releasedCount, long releasedAmount,
            long settledNotCompleted,
            long completedNotSettled,
            long failedWithoutRelease) {
    }

    /** One persisted deployment registry row. */
    public record DeploymentRecord(
            String providerId, String protocol, String admissionState, Instant updatedAt) {
    }

    private final JdbcTemplate jdbc;

    public QuotaReconciliationService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** ADMIN: reconcile the ledger against terminal states since the window floor. */
    public Reconciliation reconcile(long adminAccountId, int windowDays) {
        if (adminAccountId <= 0) {
            throw new IllegalArgumentException("adminAccountId must be positive");
        }
        int days = Math.clamp(windowDays, 1, 90);
        Instant since = Instant.now().minus(Duration.ofDays(days));
        return jdbc.queryForObject(
                "SELECT out_settled_count, out_settled_amount, out_released_count, "
                        + "out_released_amount, out_settled_not_completed, "
                        + "out_completed_not_settled, out_failed_without_release "
                        + "FROM vc.admin_quota_reconciliation(?, ?)",
                (rs, rowNum) -> new Reconciliation(
                        rs.getLong("out_settled_count"),
                        rs.getLong("out_settled_amount"),
                        rs.getLong("out_released_count"),
                        rs.getLong("out_released_amount"),
                        rs.getLong("out_settled_not_completed"),
                        rs.getLong("out_completed_not_settled"),
                        rs.getLong("out_failed_without_release")),
                adminAccountId,
                Timestamp.from(since));
    }

    /** ADMIN: the persisted deployment registry, ordered by provider id. */
    public List<DeploymentRecord> registry(long adminAccountId) {
        if (adminAccountId <= 0) {
            throw new IllegalArgumentException("adminAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_provider_id, out_protocol, out_admission_state, out_updated_at "
                        + "FROM vc.admin_provider_registry(?)",
                (rs, rowNum) -> new DeploymentRecord(
                        rs.getString("out_provider_id"),
                        rs.getString("out_protocol"),
                        rs.getString("out_admission_state"),
                        rs.getTimestamp("out_updated_at").toInstant()),
                adminAccountId);
    }
}
