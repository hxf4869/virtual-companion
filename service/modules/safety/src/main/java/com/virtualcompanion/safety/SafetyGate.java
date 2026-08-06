package com.virtualcompanion.safety;

import java.util.List;
import java.util.Objects;

/**
 * Deterministic-priority, fail-closed safety gate.
 *
 * <p>Priority is fixed: deterministic hard rules take precedence over approved classifier
 * signals ({@code deterministic_hard_rules > approved_classifier_signals}). A model
 * classifier may raise but never lower a hard-rule risk, so any hard-rule violation forces
 * {@link SafetyVerdict#BLOCK} regardless of the classifier report. Among classifier reports,
 * only an {@linkplain ClassifierReport#adequate() adequate} CLASSIFIED report may yield
 * ALLOW; every failure outcome (LOW_CONFIDENCE, TIMEOUT, UNAVAILABLE, INVALID_RESPONSE,
 * RULE_CONFLICT) fails closed to BLOCK — unreviewed free-form content is never released.
 *
 * <p>The gate is a pure function: the same inputs always produce the same verdict.
 */
public final class SafetyGate {

    private SafetyGate() {
    }

    /**
     * Evaluate the gate.
     *
     * @param hardRuleViolations deterministic hard-rule ids that tripped (may be empty)
     * @param classifier         the model-classifier report
     */
    public static SafetyVerdict evaluate(List<String> hardRuleViolations, ClassifierReport classifier) {
        Objects.requireNonNull(hardRuleViolations, "hardRuleViolations must not be null");
        Objects.requireNonNull(classifier, "classifier must not be null");
        for (String ruleId : hardRuleViolations) {
            Objects.requireNonNull(ruleId, "hardRuleViolations must not contain null");
            if (ruleId.isBlank()) {
                throw new IllegalArgumentException("hardRuleViolations must not contain blank ids");
            }
        }
        // 1. Deterministic hard rules are absolute; a classifier can never lower this risk.
        if (!hardRuleViolations.isEmpty()) {
            return SafetyVerdict.BLOCK;
        }
        // 2. Fail-closed: only an adequate CLASSIFIED report may allow.
        return classifier.adequate() ? SafetyVerdict.ALLOW : SafetyVerdict.BLOCK;
    }
}
