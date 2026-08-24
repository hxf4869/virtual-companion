package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S0-24-C durable provider rollback. The write path is owner-free and can only
 * invoke the narrow SECURITY DEFINER function; it never issues table DML.
 */
public final class ProviderRollbackService {

    static final String ROLLBACK_SQL =
            "SELECT out_history_id, out_previous_admission_state, out_changed, "
                    + "out_rolled_back_at FROM vc.rollback_provider_deployment(?, ?, ?)";
    static final String RECENT_HISTORY_SQL =
            "SELECT id, provider_id, trigger_code, actor_code, "
                    + "previous_admission_state, changed, rolled_back_at "
                    + "FROM vc.provider_rollback_history WHERE provider_id = ? "
                    + "ORDER BY rolled_back_at DESC, id DESC LIMIT ?";

    private static final int MAX_HISTORY_LIMIT = 100;
    private static final Set<String> TRIGGER_CODES = Set.of(
            "CONSECUTIVE_FAILURES", "SAFETY_LEAK", "BILLING_DRIFT", "OPERATOR");
    private static final Set<String> ACTOR_CODES = Set.of("AUTO", "OPERATOR");

    public record RollbackResult(
            long historyId,
            String previousAdmissionState,
            boolean changed,
            Instant rolledBackAt) {
    }

    /** A sanitized history row; it intentionally contains no endpoint or payload fields. */
    public record HistoryEntry(
            long id,
            String providerId,
            String triggerCode,
            String actorCode,
            String previousAdmissionState,
            boolean changed,
            Instant rolledBackAt) {
    }

    private final JdbcTemplate jdbc;

    public ProviderRollbackService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Atomically disables a deployment and records the fixed trigger and actor codes. */
    public RollbackResult rollback(String providerId, String triggerCode, String actorCode) {
        String normalizedProviderId = requireProviderId(providerId);
        requireFixedCode(triggerCode, TRIGGER_CODES, "triggerCode");
        requireFixedCode(actorCode, ACTOR_CODES, "actorCode");
        requireAllowedCombination(triggerCode, actorCode);
        return jdbc.query(
                ROLLBACK_SQL,
                (rs, rowNum) -> new RollbackResult(
                        rs.getLong("out_history_id"),
                        rs.getString("out_previous_admission_state"),
                        rs.getBoolean("out_changed"),
                        rs.getTimestamp("out_rolled_back_at").toInstant()),
                normalizedProviderId,
                triggerCode,
                actorCode).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("rollback_provider_deployment returned no row"));
    }

    /**
     * Reads a provider-scoped, bounded history page on a privileged operator
     * connection. Runtime roles receive no direct table privilege from V98.
     */
    public List<HistoryEntry> recentHistory(String providerId, int limit) {
        String normalizedProviderId = requireProviderId(providerId);
        if (limit <= 0 || limit > MAX_HISTORY_LIMIT) {
            throw new IllegalArgumentException("limit must be within 1..100");
        }
        return jdbc.query(
                RECENT_HISTORY_SQL,
                (rs, rowNum) -> new HistoryEntry(
                        rs.getLong("id"),
                        rs.getString("provider_id"),
                        rs.getString("trigger_code"),
                        rs.getString("actor_code"),
                        rs.getString("previous_admission_state"),
                        rs.getBoolean("changed"),
                        rs.getTimestamp("rolled_back_at").toInstant()),
                normalizedProviderId,
                limit);
    }

    private static String requireProviderId(String providerId) {
        Objects.requireNonNull(providerId, "providerId must not be null");
        String normalized = providerId.trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("providerId must not be blank");
        }
        return normalized;
    }

    private static void requireAllowedCombination(String triggerCode, String actorCode) {
        boolean allowed = switch (triggerCode) {
            case "CONSECUTIVE_FAILURES" -> "AUTO".equals(actorCode);
            case "SAFETY_LEAK", "OPERATOR" -> "OPERATOR".equals(actorCode);
            case "BILLING_DRIFT" -> true;
            default -> false;
        };
        if (!allowed) {
            throw new IllegalArgumentException("triggerCode/actorCode combination is unsupported");
        }
    }

    private static void requireFixedCode(String code, Set<String> allowed, String name) {
        Objects.requireNonNull(code, name + " must not be null");
        if (!allowed.contains(code)) {
            throw new IllegalArgumentException(name + " is unsupported");
        }
    }
}
