package com.virtualcompanion.safety;

/**
 * Deterministic ZERO_LLM safety response used when the pipeline blocks.
 *
 * <p>When all approved review paths are unavailable or the pipeline blocks, the system emits
 * this fixed response rather than invoking a model — it never bypasses safety. The text is a
 * constant, not generated, so it is deterministic and carries no provider coupling.
 */
public final class DeterministicSafetyResponse {

    /** The fixed fallback message emitted on BLOCK. */
    public static final String ZERO_LLM_FALLBACK =
            "I'm not able to help with that. Let's talk about something else.";

    private DeterministicSafetyResponse() {
    }

    /**
     * The deterministic response for a verdict: the ZERO_LLM fallback on BLOCK, empty
     * otherwise (ALLOW flows the original content; PAUSE streams nothing yet).
     */
    public static String fallbackFor(SafetyVerdict verdict) {
        if (verdict == null) {
            throw new IllegalArgumentException("verdict must not be null");
        }
        return verdict == SafetyVerdict.BLOCK ? ZERO_LLM_FALLBACK : "";
    }
}
