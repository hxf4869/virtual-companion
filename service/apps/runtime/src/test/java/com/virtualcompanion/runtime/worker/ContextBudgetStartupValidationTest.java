package com.virtualcompanion.runtime.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.virtualcompanion.runtime.VirtualCompanionRuntimeApplication;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;

/**
 * S0-03 acceptance: an ILLEGAL context budget must fail startup instead of
 * silently falling back (the drift this task fixes made bad deployments
 * invisible). Covers value bounds (zero/negative input/output/turns), the
 * combination rule (output &ge; input), and non-numeric values rejected by
 * type-safe binding. Valid overrides are covered by
 * {@code ContextBudgetWiringIntegrationTest}.
 */
class ContextBudgetStartupValidationTest {

    @Test
    void zeroInputTokensFailStartup() {
        assertStartupFailsWith(
                "max-input-tokens must be positive",
                "VC_CONTEXT_MAX_INPUT_TOKENS=0");
    }

    @Test
    void negativeOutputTokensFailStartup() {
        assertStartupFailsWith(
                "max-output-tokens must be positive",
                "VC_CONTEXT_MAX_OUTPUT_TOKENS=-2048");
    }

    @Test
    void zeroTurnsFailStartup() {
        assertStartupFailsWith(
                "max-turns must be positive",
                "VC_CONTEXT_MAX_TURNS=0");
    }

    @Test
    void outputBudgetAtOrAboveInputBudgetFailsStartup() {
        // Combination boundary: equal budgets leave the input assembly no room.
        assertStartupFailsWith(
                "must be smaller than max-input-tokens",
                "VC_CONTEXT_MAX_INPUT_TOKENS=2048",
                "VC_CONTEXT_MAX_OUTPUT_TOKENS=2048");
    }

    @Test
    void nonNumericBudgetFailsTypeSafeBinding() {
        // The old @Value-on-a-drifted-path wiring never saw deployment
        // variables at all; the unified path binds them strictly.
        assertStartupFailsWith(
                "virtual-companion.context-budget.max-input-tokens",
                "VC_CONTEXT_MAX_INPUT_TOKENS=not-a-number");
    }

    private static void assertStartupFailsWith(String expectedFragment, String... properties) {
        assertThatThrownBy(() -> new SpringApplicationBuilder(VirtualCompanionRuntimeApplication.class)
                .properties(properties)
                .run())
                .satisfies(t -> assertThat(chainMessages(t))
                        .contains(expectedFragment));
        // A failed run leaves no half-started JVM state behind; each call owns
        // its application context, which Spring closes on the thrown error.
    }

    private static String chainMessages(Throwable throwable) {
        StringBuilder sb = new StringBuilder();
        for (Throwable cause = throwable; cause != null; cause = cause.getCause()) {
            if (sb.length() > 0) {
                sb.append(" | ");
            }
            sb.append(cause.getClass().getSimpleName()).append(": ")
                    .append(cause.getMessage() == null ? "" : cause.getMessage());
        }
        return sb.toString();
    }
}
