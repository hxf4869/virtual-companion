package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Durable alert-webhook outbox (S0-31-A). Runtime roles never take table DML.
 */
public final class AlertWebhookOutbox {

    static final String ENQUEUE_SQL =
            "SELECT out_id, out_inserted FROM vc.enqueue_alert_webhook(?, ?, ?, ?)";
    static final String CLAIM_SQL =
            "SELECT out_id, out_severity, out_code, out_message, out_occurred_at, out_attempt_count"
                    + " FROM vc.claim_alert_webhook(?)";
    static final String COMPLETE_SQL =
            "SELECT vc.complete_alert_webhook(?, ?, ?, ?, ?)";

    public record EnqueueResult(long id, boolean inserted) {
    }

    public record Claimed(
            long id,
            String severity,
            String code,
            String message,
            Instant occurredAt,
            int attemptCount) {
    }

    private final JdbcTemplate jdbc;

    public AlertWebhookOutbox(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    public EnqueueResult enqueue(String severity, String code, String message, int windowSeconds) {
        Objects.requireNonNull(severity, "severity must not be null");
        Objects.requireNonNull(code, "code must not be null");
        Objects.requireNonNull(message, "message must not be null");
        if (windowSeconds <= 0) {
            throw new IllegalArgumentException("windowSeconds must be positive");
        }
        return jdbc.query(
                ENQUEUE_SQL,
                (rs, rowNum) -> new EnqueueResult(
                        rs.getLong("out_id"),
                        rs.getBoolean("out_inserted")),
                severity,
                code,
                message,
                windowSeconds).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("enqueue_alert_webhook returned no row"));
    }

    public List<Claimed> claim(int limit) {
        if (limit <= 0) {
            throw new IllegalArgumentException("limit must be positive");
        }
        return jdbc.query(
                CLAIM_SQL,
                (rs, rowNum) -> new Claimed(
                        rs.getLong("out_id"),
                        rs.getString("out_severity"),
                        rs.getString("out_code"),
                        rs.getString("out_message"),
                        rs.getTimestamp("out_occurred_at").toInstant(),
                        rs.getInt("out_attempt_count")),
                limit);
    }

    public boolean complete(
            long id, String outcome, String error, int maxAttempts, int backoffSeconds) {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(outcome, "outcome must not be null");
        Boolean done = jdbc.queryForObject(
                COMPLETE_SQL,
                Boolean.class,
                id,
                outcome,
                error,
                maxAttempts,
                backoffSeconds);
        return Boolean.TRUE.equals(done);
    }
}
