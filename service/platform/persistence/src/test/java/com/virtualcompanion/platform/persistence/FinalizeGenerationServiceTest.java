package com.virtualcompanion.platform.persistence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/**
 * Pure unit tests for the {@link FinalizeGenerationService.FinalizeResult} value
 * object and the eager {@code validateFinalize} argument checks.
 *
 * <p>The atomic runtime behavior of {@code vc.finalize_generation} (atomic
 * commit or full rollback under fault injection; FINAL_REVIEW precondition;
 * at-most-one final candidate; EXECUTE isolation) is proven by the SQL test
 * suite under {@code infra/db/tests}; this only pins the in-process invariants.
 */
class FinalizeGenerationServiceTest {

    @Test
    void finalizeResultKeepsFields() {
        FinalizeGenerationService.FinalizeResult result =
                new FinalizeGenerationService.FinalizeResult(901L, 7001L, true);
        assertEquals(901L, result.generationId());
        assertEquals(7001L, result.assistantMessageId());
        assertEquals(true, result.finalized());
    }

    @Test
    void finalizeResultRejectsNonPositiveIds() {
        assertThrows(IllegalArgumentException.class,
                () -> new FinalizeGenerationService.FinalizeResult(0L, 7001L, true));
        assertThrows(IllegalArgumentException.class,
                () -> new FinalizeGenerationService.FinalizeResult(901L, 0L, true));
    }

    @Test
    void validateFinalizeAcceptsValidArguments() {
        assertDoesNotThrow(() -> FinalizeGenerationService.validateFinalize(
                7L, 901L, 500L, "hello", "provider-a", "USD"));
    }

    @Test
    void validateFinalizeRejectsNonPositiveKeys() {
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(0L, 901L, 500L, "x", "p", "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 0L, 500L, "x", "p", "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 0L, "x", "p", "USD"));
    }

    @Test
    void validateFinalizeRejectsNullOrBlankStrings() {
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 500L, null, "p", "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 500L, "x", null, "USD"));
        assertThrows(IllegalArgumentException.class,
                () -> FinalizeGenerationService.validateFinalize(7L, 901L, 500L, "x", "p", "  "));
    }
}
