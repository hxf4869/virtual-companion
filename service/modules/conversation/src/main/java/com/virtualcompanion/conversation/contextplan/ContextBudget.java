package com.virtualcompanion.conversation.contextplan;

/**
 * Token and turn budget for one generation turn.
 *
 * <p>Every component is positive so a plan always reserves room for both input
 * assembly and output. The budget is part of the deterministic plan projection:
 * the same inputs reproduce the same budget.
 */
public record ContextBudget(int maxInputTokens, int maxOutputTokens, int maxTurns) {

    public ContextBudget {
        if (maxInputTokens <= 0) {
            throw new IllegalArgumentException("maxInputTokens must be positive");
        }
        if (maxOutputTokens <= 0) {
            throw new IllegalArgumentException("maxOutputTokens must be positive");
        }
        if (maxTurns <= 0) {
            throw new IllegalArgumentException("maxTurns must be positive");
        }
    }
}
