package com.virtualcompanion.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.catalog.RiskLevel;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link DeterministicSafetyClassifier} (SAFETY-WIRE): the
 * deterministic rule floor — hits block at the catalog risk level, misses
 * allow via the fail-closed gate, and stages select disjoint rule sets.
 */
class DeterministicSafetyClassifierTest {

    private final DeterministicSafetyClassifier classifier = new DeterministicSafetyClassifier();

    @Test
    void normalInputIsAllowedAtR0() {
        SafetyClassification result = classifier.classify(
                SafetyStage.INPUT, "今天上班好累，想找人说说话。");

        assertTrue(result.allowed());
        assertEquals(RiskLevel.R0_NORMAL, result.riskLevel());
        assertTrue(result.hardRuleViolations().isEmpty());
        assertTrue(result.report().adequate());
    }

    @Test
    void imminentSelfHarmInputBlocksAtR4() {
        SafetyClassification result = classifier.classify(
                SafetyStage.INPUT, "我真的撑不住了，我想自杀");

        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(RiskLevel.R4_IMMINENT, result.riskLevel());
        assertEquals(List.of("input-imminent-self-harm"), result.hardRuleViolations());
    }

    @Test
    void selfHarmInputBlocksAtR3() {
        SafetyClassification result = classifier.classify(
                SafetyStage.INPUT, "最近我总是想死");

        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(RiskLevel.R3_HIGH, result.riskLevel());
        assertEquals(List.of("input-self-harm"), result.hardRuleViolations());
    }

    @Test
    void inputRulesDoNotFireOnAssistantOutput() {
        // The output stage has no input rules; crisis wording in assistant
        // content is the model classifier's job, not this deterministic floor.
        SafetyClassification result = classifier.classify(
                SafetyStage.OUTPUT, "如果你说想自杀，请立刻联系当地紧急服务。");

        assertTrue(result.allowed());
    }

    @Test
    void humanClaimOutputBlocksAtR3() {
        SafetyClassification result = classifier.classify(
                SafetyStage.OUTPUT, "其实我是真人，我在乎你。");

        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(RiskLevel.R3_HIGH, result.riskLevel());
        assertEquals(List.of("output-ai-identity-human-claim"), result.hardRuleViolations());
    }

    @Test
    void englishPhrasesMatchCaseInsensitively() {
        assertEquals(SafetyVerdict.BLOCK,
                classifier.classify(SafetyStage.INPUT, "I want to KILL MYSELF tonight").verdict());
        assertEquals(SafetyVerdict.BLOCK,
                classifier.classify(SafetyStage.OUTPUT, "Honestly, I AM A HUMAN like you").verdict());
    }

    @Test
    void plainMentionOfAiIdentityIsAllowed() {
        // Transparency wording itself must never trip the human-claim rule.
        assertTrue(classifier.classify(
                SafetyStage.OUTPUT, "我是 AI 陪伴，不是真人。由人工智能生成回复。").allowed());
    }

    @Test
    void highestRiskWinsWhenMultipleRulesTrip() {
        SafetyClassification result = classifier.classify(
                SafetyStage.INPUT, "我想自残，也想自杀");

        assertEquals(RiskLevel.R4_IMMINENT, result.riskLevel());
        assertEquals(2, result.hardRuleViolations().size());
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
    }
}
