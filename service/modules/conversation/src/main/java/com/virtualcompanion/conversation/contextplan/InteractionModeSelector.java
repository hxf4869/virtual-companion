package com.virtualcompanion.conversation.contextplan;

/**
 * Deterministic {@link InteractionMode} selection for a generation turn.
 *
 * <p>The gentle-listener persona biases toward {@link InteractionMode#LISTEN}.
 * The selector is a pure function of observable signals — it never consults a
 * provider session or model output — so the same inputs always reproduce the
 * same mode (TASK-0019 deterministic-selection acceptance). After a soft cap of
 * consecutive LISTEN turns the companion gently surfaces DISCUSS so it never
 * loops silently; an explicit discussion signal from the user opens DISCUSS
 * immediately.
 */
public final class InteractionModeSelector {

    /**
     * Default number of consecutive LISTEN turns after which DISCUSS is surfaced.
     */
    public static final int DEFAULT_LISTEN_SOFT_CAP = 3;

    private InteractionModeSelector() {
    }

    /**
     * Select the interaction mode deterministically.
     *
     * @param userOpenedDiscussion   true if the user explicitly opened a discussion
     * @param consecutiveListenTurns number of immediately preceding LISTEN turns (&gt;= 0)
     */
    public static InteractionMode select(boolean userOpenedDiscussion, int consecutiveListenTurns) {
        if (consecutiveListenTurns < 0) {
            throw new IllegalArgumentException("consecutiveListenTurns must not be negative");
        }
        if (userOpenedDiscussion) {
            return InteractionMode.DISCUSS;
        }
        if (consecutiveListenTurns >= DEFAULT_LISTEN_SOFT_CAP) {
            return InteractionMode.DISCUSS;
        }
        return InteractionMode.LISTEN;
    }
}
