package com.virtualcompanion.safety;

import com.virtualcompanion.catalog.SafetyClassifierOutcome;
import java.util.Objects;

/**
 * One model-classifier report for a piece of content: its catalog outcome and a confidence
 * in {@code [0.0, 1.0]}.
 *
 * <p>A report is {@linkplain #adequate() adequate} only when the outcome is {@link
 * SafetyClassifierOutcome#CLASSIFIED} and the confidence meets {@link #ADEQUATE_CONFIDENCE}.
 * Every other outcome is a failure outcome and fails closed regardless of confidence.
 */
public record ClassifierReport(SafetyClassifierOutcome outcome, double confidence) {

    /** Minimum confidence for a CLASSIFIED report to release content. */
    public static final double ADEQUATE_CONFIDENCE = 0.80;

    public ClassifierReport {
        Objects.requireNonNull(outcome, "outcome must not be null");
        if (!Double.isFinite(confidence) || confidence < 0.0 || confidence > 1.0) {
            throw new IllegalArgumentException("confidence must be a finite value in [0.0, 1.0]");
        }
    }

    /**
     * Whether this report may contribute to an ALLOW. Only a CLASSIFIED report with
     * adequate confidence qualifies; all failure outcomes are inadequate.
     */
    public boolean adequate() {
        return outcome == SafetyClassifierOutcome.CLASSIFIED && confidence >= ADEQUATE_CONFIDENCE;
    }
}
