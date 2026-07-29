package com.virtualcompanion.modelruntime.contract;

import java.time.Duration;

/**
 * Neutral timeout budget. Adapters must map expiry to normalized failures.
 */
public record TimeoutBudget(
        Duration connectTimeout,
        Duration firstTokenTimeout,
        Duration totalTimeout
) {

    public TimeoutBudget {
        connectTimeout = ContractChecks.requirePositive(connectTimeout, "connectTimeout");
        firstTokenTimeout = ContractChecks.requirePositive(firstTokenTimeout, "firstTokenTimeout");
        totalTimeout = ContractChecks.requirePositive(totalTimeout, "totalTimeout");
    }
}
