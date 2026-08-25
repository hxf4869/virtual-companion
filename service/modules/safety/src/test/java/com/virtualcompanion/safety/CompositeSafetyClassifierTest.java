package com.virtualcompanion.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * S0-07: hard rules first; provider can only raise risk; provider failure
 * and missing schema fail closed; a clean provider cannot un-block a hard hit.
 */
class CompositeSafetyClassifierTest {

    private static final SafetyClassifierPort HARD = new DeterministicSafetyClassifier();

    @Test
    void providerOffMatchesDeterministic() {
        CompositeSafetyClassifier composite = new CompositeSafetyClassifier(HARD);
        SafetyClassification direct = HARD.classify(SafetyStage.INPUT, "hello");
        SafetyClassification wrapped = composite.classify(SafetyStage.INPUT, "hello");
        assertEquals(direct.verdict(), wrapped.verdict());
        assertEquals(direct.riskLevel(), wrapped.riskLevel());
    }

    @Test
    void hardBlockCannotBeLoweredByCleanProvider() {
        SafetyClassification hard = HARD.classify(SafetyStage.INPUT, "我现在11岁");
        assertFalse(hard.allowed());
        SafetyClassification extra = allow();
        SafetyClassification merged = CompositeSafetyClassifier.merge(hard, extra);
        assertEquals(SafetyVerdict.BLOCK, merged.verdict());
        assertFalse(merged.hardRuleViolations().isEmpty());
    }

    @Test
    void providerFlagRaisesCleanHardResultToBlock() {
        SafetyClassification hard = HARD.classify(SafetyStage.INPUT, "today was ordinary");
        assertTrue(hard.allowed());
        SafetyClassification extra = new SafetyClassification(
                RiskLevel.R3_HIGH,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 1.0),
                SafetyVerdict.BLOCK);
        SafetyClassification merged = CompositeSafetyClassifier.merge(hard, extra);
        assertEquals(SafetyVerdict.BLOCK, merged.verdict());
        assertEquals(RiskLevel.R3_HIGH, merged.riskLevel());
        assertTrue(merged.hardRuleViolations().isEmpty());
    }

    @Test
    void lowConfidenceCleanProviderFailsClosed() {
        SafetyClassifierPort uncertain = (stage, text) -> new SafetyClassification(
                RiskLevel.R0_NORMAL,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.79),
                SafetyVerdict.ALLOW);
        SafetyClassification result = new CompositeSafetyClassifier(HARD, uncertain)
                .classify(SafetyStage.OUTPUT, "ordinary chat");
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
    }

    @Test
    void providerThrowFailsClosed() {
        SafetyClassifierPort boom = (stage, text) -> {
            throw new IllegalStateException("timeout");
        };
        CompositeSafetyClassifier composite = new CompositeSafetyClassifier(HARD, boom);
        SafetyClassification result = composite.classify(7L, SafetyStage.INPUT, "ordinary chat");
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(SafetyClassifierOutcome.UNAVAILABLE, result.report().outcome());
    }

    @Test
    void hardBlockMakesZeroRemoteCalls() {
        // DOGFOOD-STABILIZATION audit: a local hard-rule block is terminal —
        // the provider leg is never consulted (counting fake proves zero).
        java.util.concurrent.atomic.AtomicInteger calls =
                new java.util.concurrent.atomic.AtomicInteger();
        SafetyClassifierPort counting = (stage, text) -> {
            calls.incrementAndGet();
            return allow();
        };
        CompositeSafetyClassifier composite = new CompositeSafetyClassifier(HARD, counting);
        SafetyClassification result = composite.classify(7L, SafetyStage.INPUT, "我现在11岁");
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertFalse(result.hardRuleViolations().isEmpty());
        assertEquals(0, calls.get());
    }

    @Test
    void cleanInputMakesExactlyOneRemoteCall() {
        java.util.concurrent.atomic.AtomicInteger calls =
                new java.util.concurrent.atomic.AtomicInteger();
        // The owner-aware entry is a default method, so the counting stub is
        // an anonymous class overriding it (a lambda could only implement the
        // owner-less SAM).
        SafetyClassifierPort counting = new SafetyClassifierPort() {
            @Override
            public SafetyClassification classify(SafetyStage stage, String text) {
                throw new AssertionError("the owner-less entry must not reach the remote leg");
            }

            @Override
            public SafetyClassification classify(long ownerUserId, SafetyStage stage, String text) {
                assertEquals(7L, ownerUserId);
                calls.incrementAndGet();
                return allow();
            }
        };
        CompositeSafetyClassifier composite = new CompositeSafetyClassifier(HARD, counting);
        SafetyClassification result = composite.classify(7L, SafetyStage.INPUT, "today was ordinary");
        assertTrue(result.allowed());
        assertEquals(1, calls.get());
    }

    @Test
    void ownerlessCleanInputNeverReachesTheRemoteLeg() {
        // Without an owner context the remote leg stays unusable (the runtime
        // egress gate is owner-bound); the outcome is the same fail-closed
        // block as a transport failure, with zero remote calls.
        java.util.concurrent.atomic.AtomicInteger calls =
                new java.util.concurrent.atomic.AtomicInteger();
        SafetyClassifierPort counting = (stage, text) -> {
            calls.incrementAndGet();
            return allow();
        };
        CompositeSafetyClassifier composite = new CompositeSafetyClassifier(HARD, counting);
        SafetyClassification result = composite.classify(SafetyStage.INPUT, "today was ordinary");
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(SafetyClassifierOutcome.UNAVAILABLE, result.report().outcome());
        assertEquals(0, calls.get());
    }

    @Test
    void isCleanRequiresR0AllowAndNoHardRuleHits() {
        assertTrue(CompositeSafetyClassifier.isClean(allow()));
        // ALLOW but above R0 (e.g. distress) is not clean and stays local.
        assertFalse(CompositeSafetyClassifier.isClean(new SafetyClassification(
                RiskLevel.R1_DISTRESS,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 1.0),
                SafetyVerdict.ALLOW)));
        // ALLOW with a hard-rule hit cannot occur through SafetyGate, but the
        // predicate is verified independently.
        assertFalse(CompositeSafetyClassifier.isClean(new SafetyClassification(
                RiskLevel.R0_NORMAL,
                List.of("some-rule"),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 1.0),
                SafetyVerdict.ALLOW)));
    }

    private static SafetyClassification allow() {
        return new SafetyClassification(
                RiskLevel.R0_NORMAL,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 1.0),
                SafetyVerdict.ALLOW);
    }
}
