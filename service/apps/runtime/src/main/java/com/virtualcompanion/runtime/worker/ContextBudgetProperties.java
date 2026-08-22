package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.conversation.contextplan.ContextBudget;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * S0-03 (CTX-BUDGET): type-safe deployment binding for the per-turn context
 * token/turn budget consumed by {@link LiveInvocationAssembler}.
 *
 * <p>The canonical configuration path is {@code virtual-companion.context-budget.*}
 * — application.yaml maps the {@code VC_CONTEXT_*} environment variables onto
 * it. This record is the SINGLE binding surface: before S0-03 the assembler
 * bean read the drifted {@code virtual-companion.generation.context-budget.*}
 * path that application.yaml never declared, so an operator setting e.g.
 * {@code VC_CONTEXT_MAX_INPUT_TOKENS=4000} silently fell back to the compiled
 * defaults. Binding now goes env var → yaml → this validated record → the
 * assembler bean, and a wrong value fails startup instead of drifting.
 *
 * @param maxInputTokens  deterministic input-token budget for one generation
 *                        turn (history + persona + recall blocks)
 * @param maxOutputTokens output token budget reserved for the completion
 * @param maxTurns        conversation turn budget for one plan projection
 */
@ConfigurationProperties("virtual-companion.context-budget")
@Validated
public record ContextBudgetProperties(
        @Positive int maxInputTokens,
        @Positive int maxOutputTokens,
        @Positive int maxTurns) {

    public ContextBudgetProperties {
        if (maxInputTokens <= 0) {
            throw new IllegalArgumentException(
                    "virtual-companion.context-budget.max-input-tokens must be positive");
        }
        if (maxOutputTokens <= 0) {
            throw new IllegalArgumentException(
                    "virtual-companion.context-budget.max-output-tokens must be positive");
        }
        if (maxTurns <= 0) {
            throw new IllegalArgumentException(
                    "virtual-companion.context-budget.max-turns must be positive");
        }
        // Combination rule: the reserved output must stay strictly below the
        // input budget so the input assembly (persona + recall + history)
        // always retains more room than the completion can ever consume; the
        // two halves of one turn can never collide inside a shared window.
        if (maxOutputTokens >= maxInputTokens) {
            throw new IllegalArgumentException(
                    "virtual-companion.context-budget.max-output-tokens ("
                            + maxOutputTokens
                            + ") must be smaller than max-input-tokens ("
                            + maxInputTokens
                            + ") so input assembly always retains room");
        }
    }

    /** Domain projection handed to the {@link LiveInvocationAssembler}. */
    public ContextBudget toBudget() {
        return new ContextBudget(maxInputTokens, maxOutputTokens, maxTurns);
    }
}
