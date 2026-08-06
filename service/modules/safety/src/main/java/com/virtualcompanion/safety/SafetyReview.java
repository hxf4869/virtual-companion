package com.virtualcompanion.safety;

/**
 * Incremental and final review gates over a {@link SafetyVerdict}.
 *
 * <p>The incremental gate maps a non-ALLOW gate verdict to {@link SafetyVerdict#PAUSE}
 * (pausing streaming pending further review); the final gate maps a non-ALLOW verdict to
 * {@link SafetyVerdict#BLOCK}. {@code chat.completed} may be emitted only when the final
 * verdict is ALLOW — a final-review failure therefore prevents {@code chat.completed}.
 */
public final class SafetyReview {

    private SafetyReview() {
    }

    private static SafetyVerdict require(SafetyVerdict verdict) {
        if (verdict == null) {
            throw new IllegalArgumentException("verdict must not be null");
        }
        return verdict;
    }

    /**
     * Incremental review: a non-ALLOW gate verdict pauses streaming.
     */
    public static SafetyVerdict incrementalReview(SafetyVerdict gateVerdict) {
        require(gateVerdict);
        return gateVerdict == SafetyVerdict.ALLOW ? SafetyVerdict.ALLOW : SafetyVerdict.PAUSE;
    }

    /**
     * Final review: a non-ALLOW gate verdict blocks completion.
     */
    public static SafetyVerdict finalReview(SafetyVerdict gateVerdict) {
        require(gateVerdict);
        return gateVerdict == SafetyVerdict.ALLOW ? SafetyVerdict.ALLOW : SafetyVerdict.BLOCK;
    }

    /**
     * Whether {@code chat.completed} may be emitted for this verdict. Only ALLOW qualifies,
     * so a final-review failure (BLOCK) never completes.
     */
    public static boolean mayComplete(SafetyVerdict verdict) {
        require(verdict);
        return verdict == SafetyVerdict.ALLOW;
    }
}
