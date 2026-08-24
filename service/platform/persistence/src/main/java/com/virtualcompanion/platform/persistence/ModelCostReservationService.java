package com.virtualcompanion.platform.persistence;

import java.math.BigDecimal;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/** S0-29 atomic provider-cost reserve/settle/release facade. */
public final class ModelCostReservationService {

    public record Reservation(long id, BigDecimal reservedUsd, String threshold, boolean inserted) {}

    public record Settlement(BigDecimal actualUsd, boolean changed) {}

    private final JdbcTemplate jdbc;
    private final BigDecimal monthlyCapUsd;

    public ModelCostReservationService(JdbcTemplate jdbc, BigDecimal monthlyCapUsd) {
        this.monthlyCapUsd = Objects.requireNonNull(monthlyCapUsd, "monthlyCapUsd must not be null");
        if (monthlyCapUsd.signum() < 0) {
            throw new IllegalArgumentException("monthlyCapUsd must not be negative");
        }
        this.jdbc = monthlyCapUsd.signum() > 0
                ? Objects.requireNonNull(jdbc, "jdbc must not be null when cost guard is enabled")
                : jdbc;
    }

    public boolean enabled() {
        return monthlyCapUsd.signum() > 0;
    }

    public Reservation reserve(
            long ownerUserId,
            long workItemId,
            String providerAttemptId,
            String providerId,
            String modelId,
            long estimatedInputTokens,
            long estimatedOutputTokens) {
        if (!enabled()) {
            throw new IllegalStateException("model cost reservation is disabled");
        }
        if (ownerUserId <= 0 || workItemId <= 0
                || estimatedInputTokens < 0 || estimatedOutputTokens < 0) {
            throw new IllegalArgumentException("cost reservation inputs are invalid");
        }
        return jdbc.query(
                "SELECT out_reservation_id, out_reserved_usd, out_threshold, out_inserted "
                        + "FROM vc.reserve_model_cost(?, ?, ?, ?, ?, ?, ?, ?)",
                (rs, rowNum) -> new Reservation(
                        rs.getLong("out_reservation_id"),
                        rs.getBigDecimal("out_reserved_usd"),
                        rs.getString("out_threshold"),
                        rs.getBoolean("out_inserted")),
                ownerUserId,
                workItemId,
                requireText(providerAttemptId, "providerAttemptId"),
                requireText(providerId, "providerId"),
                requireText(modelId, "modelId"),
                estimatedInputTokens,
                estimatedOutputTokens,
                monthlyCapUsd).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("reserve_model_cost returned no row"));
    }

    public Settlement settle(String providerAttemptId, long inputTokens, long outputTokens) {
        if (inputTokens < 0 || outputTokens < 0) {
            throw new IllegalArgumentException("actual tokens must not be negative");
        }
        return jdbc.query(
                "SELECT out_actual_usd, out_changed FROM vc.settle_model_cost(?, ?, ?)",
                (rs, rowNum) -> new Settlement(
                        rs.getBigDecimal("out_actual_usd"),
                        rs.getBoolean("out_changed")),
                requireText(providerAttemptId, "providerAttemptId"),
                inputTokens,
                outputTokens).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("settle_model_cost returned no row"));
    }

    public boolean release(String providerAttemptId) {
        Boolean released = jdbc.queryForObject(
                "SELECT vc.release_model_cost(?)",
                Boolean.class,
                requireText(providerAttemptId, "providerAttemptId"));
        return Boolean.TRUE.equals(released);
    }

    public BigDecimal monthlyCapUsd() {
        return monthlyCapUsd;
    }

    private static String requireText(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
