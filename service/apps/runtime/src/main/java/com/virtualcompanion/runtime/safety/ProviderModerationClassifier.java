package com.virtualcompanion.runtime.safety;

import com.virtualcompanion.catalog.RiskLevel;
import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import com.virtualcompanion.safety.ClassifierReport;
import com.virtualcompanion.safety.SafetyClassification;
import com.virtualcompanion.safety.SafetyClassifierPort;
import com.virtualcompanion.safety.SafetyStage;
import com.virtualcompanion.safety.SafetyVerdict;
import java.util.List;
import java.util.Objects;

/**
 * S0-07 adapter: OpenAI-compatible moderation as a SafetyClassifierPort.
 * Default-off; the composite owns fail-closed merge. Never logs the body.
 */
public final class ProviderModerationClassifier implements SafetyClassifierPort {

    private final OpenAiCompatModerationClient client;

    public ProviderModerationClassifier(OpenAiCompatModerationClient client) {
        this.client = Objects.requireNonNull(client, "client");
    }

    @Override
    public SafetyClassification classify(SafetyStage stage, String text) {
        OpenAiCompatModerationClient.ModerationResult result = client.moderate(text);
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
}
