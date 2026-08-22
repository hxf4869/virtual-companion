package com.virtualcompanion.safety;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import java.util.List;
import java.util.Objects;

/**
 * S0-07: fail-closed composite classifier. Deterministic hard rules run
 * first; an optional provider classifier may only raise risk. Timeouts,
 * missing schema, low confidence and conflicts block. Real moderation is
 * wired by the runtime and stays default-off.
 */
public final class CompositeSafetyClassifier implements SafetyClassifierPort {

    private final SafetyClassifierPort hardRules;
    private final SafetyClassifierPort provider;

    public CompositeSafetyClassifier(SafetyClassifierPort hardRules) {
        this(hardRules, null);
    }

    public CompositeSafetyClassifier(
            SafetyClassifierPort hardRules, SafetyClassifierPort provider) {
        this.hardRules = Objects.requireNonNull(hardRules, "hardRules");
        this.provider = provider;
    }

    @Override
    public SafetyClassification classify(SafetyStage stage, String text) {
        SafetyClassification hard = hardRules.classify(stage, text);
        if (provider == null) {
            return hard;
        }
        SafetyClassification extra;
        try {
            extra = provider.classify(stage, text);
        } catch (RuntimeException ignored) {
            extra = unavailable();
        }
        return merge(hard, extra);
    }

    /**
     * Provider may raise risk/verdict; it cannot drop hard-rule violations
     * or convert a hard BLOCK into ALLOW.
     */
    static SafetyClassification merge(
            SafetyClassification hard, SafetyClassification extra) {
        Objects.requireNonNull(hard, "hard");
        Objects.requireNonNull(extra, "extra");
        List<String> violations = hard.hardRuleViolations();
        RiskLevel risk = max(hard.riskLevel(), extra.riskLevel());
        ClassifierReport report = extra.report();
        if (!violations.isEmpty()) {
            report = hard.report();
        }
        SafetyVerdict verdict = SafetyGate.evaluate(violations, report);
        if (hard.verdict() == SafetyVerdict.BLOCK || extra.verdict() == SafetyVerdict.BLOCK) {
            verdict = SafetyVerdict.BLOCK;
        }
        return new SafetyClassification(risk, violations, report, verdict);
    }

    static SafetyClassification unavailable() {
        return new SafetyClassification(
                RiskLevel.R3_HIGH,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.UNAVAILABLE, 0.0),
                SafetyVerdict.BLOCK);
    }

    private static RiskLevel max(RiskLevel left, RiskLevel right) {
        return left.ordinal() >= right.ordinal() ? left : right;
    }
}
