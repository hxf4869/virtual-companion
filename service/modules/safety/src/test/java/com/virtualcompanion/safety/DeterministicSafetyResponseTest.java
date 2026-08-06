package com.virtualcompanion.safety;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import org.junit.jupiter.api.Test;

/**
 * Tests for {@link DeterministicSafetyResponse}: the ZERO_LLM fallback is a fixed,
 * non-blank deterministic string emitted on BLOCK (never a model call); empty otherwise.
 */
class DeterministicSafetyResponseTest {

    @Test
    void blockYieldsNonBlankDeterministicFallback() {
        String fallback = DeterministicSafetyResponse.fallbackFor(SafetyVerdict.BLOCK);
        assertEquals(DeterministicSafetyResponse.ZERO_LLM_FALLBACK, fallback);
        assertFalse(fallback.isBlank());
        assertEquals(fallback, DeterministicSafetyResponse.fallbackFor(SafetyVerdict.BLOCK),
                "fallback must be deterministic");
    }

    @Test
    void allowAndPauseYieldNoFallback() {
        assertEquals("", DeterministicSafetyResponse.fallbackFor(SafetyVerdict.ALLOW));
        assertEquals("", DeterministicSafetyResponse.fallbackFor(SafetyVerdict.PAUSE));
    }
}
