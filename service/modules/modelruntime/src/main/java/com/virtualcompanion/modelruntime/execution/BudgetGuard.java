package com.virtualcompanion.modelruntime.execution;

/**
 * BUDGET-HALT (§22.18 / §12.33): hard monthly spend ceiling for live provider
 * outbound. When the month-to-date settled cost reaches the configured cap,
 * every external attempt is refused BEFORE any outbound (fail-closed); a
 * non-positive cap disables the guard entirely.
 */
public final class BudgetGuard {

    /** Reads the month-to-date settled cost in USD (deployment-persisted). */
    public interface MonthSpendReader {
        double monthToDateUsd();
    }

    private final MonthSpendReader reader;
    private final double capUsd;

    public BudgetGuard(MonthSpendReader reader, double capUsd) {
        this.reader = java.util.Objects.requireNonNull(reader, "reader must not be null");
        this.capUsd = capUsd;
    }

    public boolean exceeded() {
        return capUsd > 0 && reader.monthToDateUsd() >= capUsd;
    }

    public double capUsd() {
        return capUsd;
    }
}
