package com.virtualcompanion.safety;

/**
 * Vendor-agnostic safety-classifier seam (SAFETY-WIRE, FR-CHAT-001).
 *
 * <p>Technical Alpha ships {@link DeterministicSafetyClassifier}; a real
 * moderation provider later replaces the implementation, never the callers.
 * The port stays pure (no I/O): every implementation must be deterministic in
 * outcome for a given input so the fail-closed gate semantics hold.
 */
public interface SafetyClassifierPort {

    /**
     * Classify one piece of content at the given pipeline stage.
     *
     * @param stage INPUT (caller message before scheduling) or OUTPUT
     *              (assistant fragment / final response)
     * @param text  the content to classify; never null
     */
    SafetyClassification classify(SafetyStage stage, String text);
}
