package com.virtualcompanion.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Tests for {@link SafetyReview}: incremental review pauses on non-ALLOW; final review blocks
 * on non-ALLOW and {@code chat.completed} may emit only on ALLOW (acceptance #2: final review
 * failure means no chat.completed).
 */
class SafetyReviewTest {

    @Test
    void incrementalNonAllowPauses() {
        assertEquals(SafetyVerdict.PAUSE, SafetyReview.incrementalReview(SafetyVerdict.BLOCK));
        assertEquals(SafetyVerdict.PAUSE, SafetyReview.incrementalReview(SafetyVerdict.PAUSE));
    }

    @Test
    void incrementalAllowPassesThrough() {
        assertEquals(SafetyVerdict.ALLOW, SafetyReview.incrementalReview(SafetyVerdict.ALLOW));
    }

    @Test
    void finalReviewFailureBlocksAndPreventsChatCompleted() {
        SafetyVerdict finalVerdict = SafetyReview.finalReview(SafetyVerdict.BLOCK);
        assertEquals(SafetyVerdict.BLOCK, finalVerdict);
        assertFalse(SafetyReview.mayComplete(finalVerdict), "chat.completed must not emit on final-review failure");
    }

    @Test
    void finalReviewAllowEmitsChatCompleted() {
        SafetyVerdict finalVerdict = SafetyReview.finalReview(SafetyVerdict.ALLOW);
        assertEquals(SafetyVerdict.ALLOW, finalVerdict);
        assertTrue(SafetyReview.mayComplete(finalVerdict));
    }

    @Test
    void pauseGateFinalizesToBlock() {
        assertEquals(SafetyVerdict.BLOCK, SafetyReview.finalReview(SafetyVerdict.PAUSE));
        assertFalse(SafetyReview.mayComplete(SafetyVerdict.PAUSE));
    }
}
