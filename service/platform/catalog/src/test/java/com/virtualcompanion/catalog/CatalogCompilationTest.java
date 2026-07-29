package com.virtualcompanion.catalog;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.Arrays;
import org.junit.jupiter.api.Test;

class CatalogCompilationTest {

    @Test
    void generatedCatalogExposesCanonicalCodes() {
        assertEquals("R0_NORMAL", RiskLevel.R0_NORMAL.code());
        assertEquals("RELATIONSHIP", MemoryScope.RELATIONSHIP.code());
        assertEquals("COMPLETED", GenerationState.COMPLETED.code());
    }

    @Test
    void forbiddenAliasesAreNotGenerated() {
        assertFalse(hasCode(RiskLevel.values(), "NORMAL"));
        assertFalse(hasCode(MemoryScope.values(), "COMPANION"));
        assertFalse(hasCode(GenerationState.values(), "FAILED_RETRYABLE"));
    }

    private static boolean hasCode(Enum<?>[] values, String code) {
        return Arrays.stream(values).anyMatch(value -> value.name().equals(code));
    }
}
