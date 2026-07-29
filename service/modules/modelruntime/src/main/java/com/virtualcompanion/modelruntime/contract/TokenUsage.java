package com.virtualcompanion.modelruntime.contract;

/**
 * Normalized token accounting reported by one adapter session.
 */
public record TokenUsage(long inputTokens, long outputTokens, long totalTokens) {

    public TokenUsage {
        inputTokens = ContractChecks.requireNonNegative(inputTokens, "inputTokens");
        outputTokens = ContractChecks.requireNonNegative(outputTokens, "outputTokens");
        totalTokens = ContractChecks.requireNonNegative(totalTokens, "totalTokens");
    }
}
