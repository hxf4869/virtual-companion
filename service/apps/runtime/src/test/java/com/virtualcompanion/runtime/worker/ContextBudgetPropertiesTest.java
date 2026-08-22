package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.virtualcompanion.conversation.contextplan.ContextBudget;
import org.junit.jupiter.api.Test;

/**
 * S0-03 (CTX-BUDGET) boundary tests for the type-safe context budget
 * configuration: value bounds (input/output/turns positive), the combination
 * rule (output strictly below input so input assembly always retains room),
 * and the domain projection handed to {@link LiveInvocationAssembler}.
 * Binding-level failures (non-numeric values, missing properties) are covered
 * by {@code ContextBudgetStartupValidationTest}; the live wiring by
 * {@code ContextBudgetWiringIntegrationTest}.
 */
class ContextBudgetPropertiesTest {

    @Test
    void projectsOntoTheDomainBudget() {
        assertEquals(
                new ContextBudget(8_000, 2_048, 64),
                new ContextBudgetProperties(8_000, 2_048, 64).toBudget());
        // The smallest legal combination also projects verbatim.
        assertEquals(
                new ContextBudget(2, 1, 1),
                new ContextBudgetProperties(2, 1, 1).toBudget());
    }

    @Test
    void rejectsNonPositiveInputBudget() {
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(0, 1, 1));
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(-4_000, 1, 1));
    }

    @Test
    void rejectsNonPositiveOutputBudget() {
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(8_000, 0, 64));
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(8_000, -1, 64));
    }

    @Test
    void rejectsNonPositiveTurnBudget() {
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(8_000, 2_048, 0));
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(8_000, 2_048, -64));
    }

    @Test
    void rejectsOutputBudgetEqualOrAboveInputBudget() {
        // Boundary: equal budgets collide (no room left for input assembly);
        // one token below is the smallest legal combination.
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(128, 128, 64));
        assertThrows(IllegalArgumentException.class, () -> new ContextBudgetProperties(128, 512, 64));
    }

    @Test
    void acceptsSmallestLegalCombination() {
        assertEquals(
                new ContextBudget(2, 1, 1),
                new ContextBudgetProperties(2, 1, 1).toBudget());
    }

    @Test
    void rejectsAreDescriptiveAboutTheOffendingProperty() {
        IllegalArgumentException combo =
                assertThrows(
                        IllegalArgumentException.class,
                        () -> new ContextBudgetProperties(100, 200, 64));
        assertEquals(
                "virtual-companion.context-budget.max-output-tokens (200) must be"
                        + " smaller than max-input-tokens (100) so input assembly always retains room",
                combo.getMessage());
    }
}
