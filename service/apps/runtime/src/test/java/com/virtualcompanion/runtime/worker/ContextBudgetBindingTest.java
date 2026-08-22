package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.virtualcompanion.conversation.contextplan.ContextBudget;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * S0-03 (CTX-BUDGET): proves the unified {@code virtual-companion.context-budget.*}
 * path declared in application.yaml binds into the type-safe
 * {@link ContextBudgetProperties} record with the shipped defaults. Before
 * S0-03 the assembler read a drifted sibling path that application.yaml never
 * declared, so nothing guarded the canonical path either.
 */
@SpringBootTest
class ContextBudgetBindingTest {

    @Autowired
    private ContextBudgetProperties properties;

    @Test
    void bindsTheShippedDefaultsOnTheUnifiedPath() {
        assertEquals(
                new ContextBudget(8_000, 2_048, 64),
                properties.toBudget());
    }
}
