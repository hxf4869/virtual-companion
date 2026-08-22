package com.virtualcompanion.modelruntime.execution;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * BUDGET-HALT (§22.18): the gate trips exactly at the configured cap and is
 * disabled entirely when the cap is non-positive.
 */
class BudgetGuardTest {

    @Test
    void tripsAtAndBeyondCap() {
        BudgetGuard g = new BudgetGuard(() -> 9.99, 10.0);
        assertFalse(g.exceeded());
        g = new BudgetGuard(() -> 10.0, 10.0);
        assertTrue(g.exceeded());
        g = new BudgetGuard(() -> 12.5, 10.0);
        assertTrue(g.exceeded());
    }

    @Test
    void nonPositiveCapDisablesTheGuard() {
        BudgetGuard off = new BudgetGuard(() -> 1_000_000.0, 0.0);
        assertFalse(off.exceeded());
    }

    @Test
    void unknownPriceFailsClosedWhenCapIsPositive() {
        BudgetGuard g = new BudgetGuard(() -> 0.0, 10.0, () -> false);
        assertTrue(g.exceeded());
    }

    @Test
    void unknownPriceDoesNotTripWhenCapDisabled() {
        BudgetGuard g = new BudgetGuard(() -> 0.0, 0.0, () -> false);
        assertFalse(g.exceeded());
    }
}
