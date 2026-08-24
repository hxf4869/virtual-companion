package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.safety.SafetyStage;
import com.virtualcompanion.safety.SafetyVerdict;
import java.util.List;
import org.junit.jupiter.api.Test;

class ProviderModerationClassifierTest {

    @Test
    void flaggedProviderResultRaisesRiskAndPreservesConfidence() {
        OpenAiCompatModerationClient client = mock(OpenAiCompatModerationClient.class);
        when(client.moderate("unsafe")).thenReturn(
                new OpenAiCompatModerationClient.ModerationResult(
                        true, List.of("violence"), 0.93));

        var result = new ProviderModerationClassifier(client)
                .classify(SafetyStage.OUTPUT, "unsafe");

        assertFalse(result.allowed());
        assertEquals(SafetyVerdict.BLOCK, result.verdict());
        assertEquals(RiskLevel.R3_HIGH, result.riskLevel());
        assertEquals(0.93, result.report().confidence(), 0.0001);
    }

    @Test
    void highConfidenceCleanResultMayPassToTheComposite() {
        OpenAiCompatModerationClient client = mock(OpenAiCompatModerationClient.class);
        when(client.moderate("ordinary")).thenReturn(
                new OpenAiCompatModerationClient.ModerationResult(
                        false, List.of(), 0.96));

        var result = new ProviderModerationClassifier(client)
                .classify(SafetyStage.INPUT, "ordinary");

        assertTrue(result.allowed());
        assertEquals(0.96, result.report().confidence(), 0.0001);
    }
}
