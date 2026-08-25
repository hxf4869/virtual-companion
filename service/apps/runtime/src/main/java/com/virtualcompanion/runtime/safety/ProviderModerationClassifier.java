package com.virtualcompanion.runtime.safety;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.safety.ClassifierReport;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyGate;
import com.virtualcompanion.safety.SafetyStage;
import com.virtualcompanion.safety.SafetyVerdict;
import java.util.List;
import java.util.Objects;

/**
 * S0-07 adapter: remote safety classification as a SafetyClassifierPort.
 * Default-off; the composite owns fail-closed merge. Never logs the body.
 *
 * <p>DOGFOOD-04 (ADR-0006 §5.2) adds a second remote family selected by
 * {@code virtual-companion.moderation.mode}: {@code openai-moderations}
 * (unchanged {@code POST {base-url}/moderations}) or {@code chat-completions}
 * (strict JSON classification over {@code POST {base-url}/chat/completions}
 * for channels without a /moderations endpoint). Both share the same
 * base-url semantics (OpenAI-compatible root such as {@code .../v1}).
 */
public final class ProviderModerationClassifier implements SafetyClassifierPort {

    private final OpenAiCompatModerationClient moderationsClient;
    private final ChatCompletionsSafetyClient chatCompletionsClient;

    public ProviderModerationClassifier(OpenAiCompatModerationClient client) {
        this.moderationsClient = Objects.requireNonNull(client, "client");
        this.chatCompletionsClient = null;
    }

    public ProviderModerationClassifier(ChatCompletionsSafetyClient client) {
        this.moderationsClient = null;
        this.chatCompletionsClient = Objects.requireNonNull(client, "client");
    }

    @Override
    public SafetyClassification classify(SafetyStage stage, String text) {
        if (chatCompletionsClient != null) {
            return classifyResult(chatCompletionsClient.classify(text));
        }
        OpenAiCompatModerationClient.ModerationResult result = moderationsClient.moderate(text);
        if (result.flagged()) {
            return new SafetyClassification(
                    RiskLevel.R3_HIGH,
                    List.of(),
                    new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, result.confidence()),
                    SafetyVerdict.BLOCK);
        }
        return new SafetyClassification(
                RiskLevel.R0_NORMAL,
                List.of(),
                new ClassifierReport(SafetyClassifierOutcome.CLASSIFIED, result.confidence()),
                SafetyVerdict.ALLOW);
    }

    /**
     * Chat-completions mapping: R0 with adequate confidence allows; R1 only
     * raises the recorded risk (distress must still reach the supportive
     * path); R2+ blocks like the flagged moderations path; confidence below
     * {@link ClassifierReport#ADEQUATE_CONFIDENCE} yields a LOW_CONFIDENCE
     * report which the gate fails closed.
     */
    private static SafetyClassification classifyResult(
            ChatCompletionsSafetyClient.ClassificationResult result) {
        SafetyClassifierOutcome outcome = result.confidence() < ClassifierReport.ADEQUATE_CONFIDENCE
                ? SafetyClassifierOutcome.LOW_CONFIDENCE
                : SafetyClassifierOutcome.CLASSIFIED;
        ClassifierReport report = new ClassifierReport(outcome, result.confidence());
        SafetyVerdict verdict = SafetyGate.evaluate(List.of(), report);
        if (result.riskLevel().ordinal() >= RiskLevel.R2_ELEVATED.ordinal()) {
            verdict = SafetyVerdict.BLOCK;
        }
        return new SafetyClassification(result.riskLevel(), List.of(), report, verdict);
    }
}
