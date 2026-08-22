package com.virtualcompanion.modelruntime.execution;

/**
 * BUDGET-HALT (§22.18 / §12.33): hard monthly spend ceiling for live provider
 * outbound. When the month-to-date settled cost reaches the configured cap,
 * every external attempt is refused BEFORE any outbound (fail-closed); a
 * non-positive cap disables the guard entirely.
 */
public final class BudgetGuard {

    /** Reads the month-to-date settled+held cost in USD (deployment-persisted). */
    public interface MonthSpendReader {
        double monthToDateUsd();
    }

    /**
     * S0-29: a current versioned unit price must exist before an outbound is
     * allowed under a positive cap. Unknown price fails closed.
     */
    public interface PricePresence {
        boolean currentPriceKnown();
    }

    private final MonthSpendReader reader;
    private final double capUsd;
    private final PricePresence prices;

    public BudgetGuard(MonthSpendReader reader, double capUsd) {
        this(reader, capUsd, () -> true);
    }

    public BudgetGuard(MonthSpendReader reader, double capUsd, PricePresence prices) {
        this.reader = java.util.Objects.requireNonNull(reader, "reader must not be null");
        this.capUsd = capUsd;
        this.prices = java.util.Objects.requireNonNull(prices, "prices must not be null");
    }

    public boolean exceeded() {
        if (capUsd <= 0) {
            return false;
        }
        if (!prices.currentPriceKnown()) {
            return true;
        }
        return reader.monthToDateUsd() >= capUsd;
    }

    public double capUsd() {
        return capUsd;
    }
}
