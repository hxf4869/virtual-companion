package com.virtualcompanion.conversation.contextplan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Determinism and invariant tests for {@link ContextPlan}. The same inputs must
 * always reproduce the same canonical assembly order, budget and mode.
 */
class ContextPlanTest {

    private final ContextBudget budget = new ContextBudget(2000, 500, 1);

    private ContextEntry entry(ContextSourceKind kind, int order) {
        return new ContextEntry(kind, order, kind.name());
    }

    @Test
    void ordersEntriesByCanonicalOrderRegardlessOfInputOrder() {
        ContextPlan plan = new ContextPlan(
                List.of(entry(ContextSourceKind.USER_INPUT, 3),
                        entry(ContextSourceKind.PERSONA, 1),
                        entry(ContextSourceKind.CONVERSATION_HISTORY, 2)),
                budget,
                InteractionMode.LISTEN);

        assertEquals(List.of(ContextSourceKind.PERSONA, ContextSourceKind.CONVERSATION_HISTORY, ContextSourceKind.USER_INPUT),
                plan.orderedEntries().stream().map(ContextEntry::sourceKind).toList());
    }

    @Test
    void sameInputsProduceEqualPlans() {
        List<ContextEntry> entries = List.of(entry(ContextSourceKind.PERSONA, 1), entry(ContextSourceKind.USER_INPUT, 2));
        ContextPlan a = new ContextPlan(entries, budget, InteractionMode.DISCUSS);
        ContextPlan b = new ContextPlan(List.copyOf(entries), new ContextBudget(2000, 500, 1), InteractionMode.DISCUSS);
        assertEquals(a, b);
        assertEquals(a.orderedEntries(), b.orderedEntries());
    }

    @Test
    void rejectsDuplicateOrder() {
        assertThrows(IllegalArgumentException.class,
                () -> new ContextPlan(List.of(entry(ContextSourceKind.PERSONA, 1), entry(ContextSourceKind.USER_INPUT, 1)),
                        budget, InteractionMode.LISTEN));
    }

    @Test
    void rejectsEmptyOrNullStructuralInputs() {
        assertThrows(IllegalArgumentException.class,
                () -> new ContextPlan(List.of(), budget, InteractionMode.LISTEN));
        assertThrows(NullPointerException.class,
                () -> new ContextPlan(List.of(entry(ContextSourceKind.PERSONA, 1)), null, InteractionMode.LISTEN));
        assertThrows(NullPointerException.class,
                () -> new ContextPlan(List.of(entry(ContextSourceKind.PERSONA, 1)), budget, null));
    }

    @Test
    void exposesBudgetAndMode() {
        ContextPlan plan = new ContextPlan(List.of(entry(ContextSourceKind.PERSONA, 1)), budget, InteractionMode.DISCUSS);
        assertEquals(budget, plan.budget());
        assertEquals(InteractionMode.DISCUSS, plan.interactionMode());
    }
}
