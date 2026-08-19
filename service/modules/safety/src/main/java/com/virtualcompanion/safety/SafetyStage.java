package com.virtualcompanion.safety;

/**
 * Which pipeline stage a classification runs at (SAFETY-WIRE).
 *
 * <p>{@code INPUT} classifies the caller's message before any model work is
 * scheduled; {@code OUTPUT} classifies assistant content (streaming fragments
 * and the final response). The stage selects the applicable deterministic rule
 * set — input rules target user-expressed crisis risk (§20.2), output rules
 * target forbidden assistant behaviour such as claiming to be human (§21.3.1).
 */
public enum SafetyStage {
    INPUT,
    OUTPUT
}
