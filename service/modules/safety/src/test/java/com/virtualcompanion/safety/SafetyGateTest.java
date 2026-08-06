package com.virtualcompanion.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Fail-closed tests for {@link SafetyGate}. Every classifier failure outcome must fail
 * closed to BLOCK (acceptance #1); hard rules are absolute (a classifier can never lower
 * hard-rule risk).
 */
class SafetyGateTest {

    @Test
    void everyClassifierFailureOutcomeFailsClosed() {
        List<String> noHardRules = List.of();
        // Iterate every catalog outcome except CLASSIFIED so a future outcome addition is
        // automatically proven to fail closed (the gate allows only on CLASSIFIED).
        for (SafetyClassifierOutcome outcome : SafetyClassifierOutcome.values()) {
            if (outcome == SafetyClassifierOutcome.CLASSIFIED) {
                continue;
            }
            // Even a high-confidence failure outcome must block.
            assertEquals(SafetyVerdict.BLOCK,
                    SafetyGate.evaluate(noHardRules, new ClassifierReport(outcome, 0.99)),
                    "failure outcome " + outcome + " must fail closed");
        }
    }

    @Test
    void classifiedAdequateConfidenceAllows() {
        assertEquals(SafetyVerdict.ALLOW,
                SafetyGate.evaluate(List.of(),
                        new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, ClassifierReport.ADEQUATE_CONFIDENCE)));
    }

    @Test
    void classifiedBelowAdequateConfidenceBlocks() {
        assertEquals(SafetyVerdict.BLOCK,
                SafetyGate.evaluate(List.of(),
                        new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, ClassifierReport.ADEQUATE_CONFIDENCE - 0.01)));
    }

    @Test
    void hardRuleViolationBlocksEvenWithAdequateClassifier() {
        // A model classifier may raise but never lower a deterministic hard-rule risk.
        ClassifierReport clean = new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, ClassifierReport.ADEQUATE_CONFIDENCE);
        assertEquals(SafetyVerdict.BLOCK, SafetyGate.evaluate(List.of("hard-rule-self-harm"), clean));
    }

    @Test
    void isDeterministic() {
        ClassifierReport report = new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95);
        List<String> rules = List.of();
        assertEquals(SafetyGate.evaluate(rules, report), SafetyGate.evaluate(rules, report));
    }

    @Test
    void rejectsBlankHardRuleIds() {
        assertThrows(IllegalArgumentException.class,
                () -> SafetyGate.evaluate(List.of("  "),
                        new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, 0.95)));
    }
}
