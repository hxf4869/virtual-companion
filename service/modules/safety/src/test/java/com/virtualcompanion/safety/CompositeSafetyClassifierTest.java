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
    void providerThrowFailsClosed() {
        SafetyClassifierPort boom = (stage, text) -> {
            throw new IllegalStateException("timeout");
        };
        CompositeSafetyClassifier composite = new CompositeSafetyClassifier(HARD, boom);
        SafetyClassification result = composite.classify(SafetyStage.INPUT, "ordinary chat");
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(SafetyClassifierOutcome.UNAVAILABLE, result.report().outcome());
    }

    private static SafetyClassification allow() {
        return new SafetyClassification(
                RiskLevel.R0_NORMAL,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 1.0),
                SafetyVerdict.ALLOW);
    }
}
