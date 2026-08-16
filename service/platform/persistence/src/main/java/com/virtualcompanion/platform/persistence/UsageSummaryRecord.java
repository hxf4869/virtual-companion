package com.virtualcompanion.platform.persistence;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Objects;

/**
 * One day of settled usage/cost aggregates (V36 ADMIN-OPS).
 *
 * <p>{@code day} is a UTC calendar day; {@code cost} is the settled
 * {@code actual_cost} sum in the deployments' currency (USD unless a
 * deployment configures otherwise).
 */
public record UsageSummaryRecord(
        LocalDate day,
        long generations,
        long inputTokens,
        long outputTokens,
        BigDecimal cost) {

    public UsageSummaryRecord {
        Objects.requireNonNull(day, "day must not be null");
        if (generations < 0) {
            throw new IllegalArgumentException("generations must not be negative");
        }
        if (inputTokens < 0) {
            throw new IllegalArgumentException("inputTokens must not be negative");
        }
        if (outputTokens < 0) {
            throw new IllegalArgumentException("outputTokens must not be negative");
        }
        Objects.requireNonNull(cost, "cost must not be null");
    }
}
