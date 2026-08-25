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
 *
 * <p>Hard rules first is enforced structurally (DOGFOOD-04 audit): a local
 * result that is not fully clean (ALLOW, no hard-rule hits, R0) is terminal
 * and the provider leg is never consulted — zero remote calls for blocked
 * or locally-flagged input. Only clean input reaches the remote classifier,
 * and the remote leg is expected to be owner-gated by the runtime wiring;
 * without an owner context it fails closed exactly like a transport
 * failure.</p>
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
        return classify(0L, stage, text);
    }

    @Override
    public SafetyClassification classify(long ownerUserId, SafetyStage stage, String text) {
        SafetyClassification hard = hardRules.classify(stage, text);
        if (provider == null) {
            return hard;
        }
        if (!isClean(hard)) {
            // Hard rules are terminal: the remote classifier can never
            // lower the risk, so consulting it would only leak locally
            // flagged text over the wire.
            return hard;
        }
        if (ownerUserId <= 0) {
            // Clean input still refuses the remote leg without an owner
            // context (the runtime gate is owner-bound by design); the
            // owner-less entry keeps the same fail-closed outcome as a
            // transport failure.
            return merge(hard, unavailable());
        }
        SafetyClassification extra;
        try {
            extra = provider.classify(ownerUserId, stage, text);
        } catch (RuntimeException ignored) {
            extra = unavailable();
        }
        return merge(hard, extra);
    }

    /**
     * Only a fully clean local result may leave the host: ALLOW verdict, no
     * hard-rule hits and risk level R0. Locally flagged distress/crisis or
     * any hard-rule hit stays local (ADR-0006 §4.3/§5.4). Public so runtime
     * egress gates reuse the exact same cleanliness predicate.
     */
    public static boolean isClean(SafetyClassification classification) {
        return classification.verdict() == SafetyVerdict.ALLOW
                && classification.hardRuleViolations().isEmpty()
                && classification.riskLevel() == RiskLevel.R0_NORMAL;
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
