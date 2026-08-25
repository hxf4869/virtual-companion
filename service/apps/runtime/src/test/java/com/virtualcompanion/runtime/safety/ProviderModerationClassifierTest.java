package com.virtualcompanion.runtime.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.safety.SafetyStage;
import com.virtualcompanion.safety.SafetyVerdict;
import java.util.List;
import org.junit.jupiter.api.Test;

class ProviderModerationClassifierTest {

    // ---- mode=openai-moderations (unchanged S0-07 shape) ----

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

    // ---- mode=chat-completions (DOGFOOD-04, ADR-0006 §5) ----

    @Test
    void chatCompletionsR3BlocksAndR0Allows() {
        ChatCompletionsSafetyClient client = mock(ChatCompletionsSafetyClient.class);
        when(client.classify("unsafe")).thenReturn(
                new ChatCompletionsSafetyClient.ClassificationResult(
                        RiskLevel.R3_HIGH, List.of("violence"), 0.91));
        when(client.classify("ordinary")).thenReturn(
                new ChatCompletionsSafetyClient.ClassificationResult(
                        RiskLevel.R0_NORMAL, List.of(), 0.97));

        var classifier = new ProviderModerationClassifier(client);
        var blocked = classifier.classify(SafetyStage.OUTPUT, "unsafe");
        assertFalse(blocked.allowed());
        assertEquals(RiskLevel.R3_HIGH, blocked.riskLevel());
        assertEquals(SafetyClassifierOutcome.CLASSIFIED, blocked.report().outcome());

        var allowed = classifier.classify(SafetyStage.INPUT, "ordinary");
        assertTrue(allowed.allowed());
        assertEquals(RiskLevel.R0_NORMAL, allowed.riskLevel());
    }

    @Test
    void chatCompletionsR1OnlyRaisesRiskWithoutBlockingTheSupportivePath() {
        // §20.2: distress (R1) must still reach the supportive response path;
        // the remote leg raises the recorded risk but does not block.
        ChatCompletionsSafetyClient client = mock(ChatCompletionsSafetyClient.class);
        when(client.classify("我最近很难过")).thenReturn(
                new ChatCompletionsSafetyClient.ClassificationResult(
                        RiskLevel.R1_DISTRESS, List.of("distress"), 0.9));

        var result = new ProviderModerationClassifier(client)
                .classify(SafetyStage.INPUT, "我最近很难过");

        assertTrue(result.allowed());
        assertEquals(RiskLevel.R1_DISTRESS, result.riskLevel());
    }

    @Test
    void chatCompletionsR2BlocksLikeTheFlaggedModerationsPath() {
        ChatCompletionsSafetyClient client = mock(ChatCompletionsSafetyClient.class);
        when(client.classify("risky")).thenReturn(
                new ChatCompletionsSafetyClient.ClassificationResult(
                        RiskLevel.R2_ELEVATED, List.of("fraud"), 0.88));

        var result = new ProviderModerationClassifier(client)
                .classify(SafetyStage.INPUT, "risky");

        assertFalse(result.allowed());
        assertEquals(RiskLevel.R2_ELEVATED, result.riskLevel());
    }

    @Test
    void chatCompletionsLowConfidenceYieldsLowConfidenceReportAndBlocks() {
        ChatCompletionsSafetyClient client = mock(ChatCompletionsSafetyClient.class);
        when(client.classify("ambiguous")).thenReturn(
                new ChatCompletionsSafetyClient.ClassificationResult(
                        RiskLevel.R0_NORMAL, List.of(), 0.5));

        var result = new ProviderModerationClassifier(client)
                .classify(SafetyStage.INPUT, "ambiguous");

        assertFalse(result.allowed());
        assertEquals(SafetyClassifierOutcome.LOW_CONFIDENCE, result.report().outcome());
        assertEquals(0.5, result.report().confidence(), 0.0001);
    }
}
