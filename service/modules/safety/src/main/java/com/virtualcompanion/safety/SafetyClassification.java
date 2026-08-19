package com.virtualcompanion.safety;

import com.virtualcompanion.catalog.RiskLevel;
import java.util.List;
import java.util.Objects;

/**
 * One classification result (SAFETY-WIRE): the deterministic hard rules that
 * tripped, the classifier report feeding {@link SafetyGate}, the resulting
 * catalog risk level and the final gate verdict.
 *
 * <p>The verdict is {@link SafetyGate#evaluate} over the violations and the
 * report, so the deterministic-priority / fail-closed semantics live in one
 * place; this record only carries the outcome.
 */
public record SafetyClassification(
        RiskLevel riskLevel,
        List<String> hardRuleViolations,
        ClassifierReport report,
        SafetyVerdict verdict) {

    public SafetyClassification {
        Objects.requireNonNull(riskLevel, "riskLevel must not be null");
        Objects.requireNonNull(hardRuleViolations, "hardRuleViolations must not be null");
        for (String ruleId : hardRuleViolations) {
            Objects.requireNonNull(ruleId, "hardRuleViolations must not contain null");
            if (ruleId.isBlank()) {
                throw new IllegalArgumentException("hardRuleViolations must not contain blank ids");
            }
        }
        Objects.requireNonNull(report, "report must not be null");
        Objects.requireNonNull(verdict, "verdict must not be null");
    }

    /** Convenience: only an ALLOW verdict releases content. */
    public boolean allowed() {
        return verdict == SafetyVerdict.ALLOW;
    }
}
