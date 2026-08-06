package com.virtualcompanion.conversation.contextplan;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

/**
 * Determinism tests for {@link InteractionModeSelector}: a pure function of
 * observable signals, reproducible for identical inputs.
 */
class InteractionModeSelectorTest {

    @Test
    void defaultsToListen() {
        assertEquals(InteractionMode.LISTEN,
                InteractionModeSelector.select(false, 0));
        assertEquals(InteractionMode.LISTEN,
                InteractionModeSelector.select(false, InteractionModeSelector.DEFAULT_LISTEN_SOFT_CAP - 1));
    }

    @Test
    void surfacesDiscussAfterListenSoftCap() {
        assertEquals(InteractionMode.DISCUSS,
                InteractionModeSelector.select(false, InteractionModeSelector.DEFAULT_LISTEN_SOFT_CAP));
        assertEquals(InteractionMode.DISCUSS,
                InteractionModeSelector.select(false, InteractionModeSelector.DEFAULT_LISTEN_SOFT_CAP + 2));
    }

    @Test
    void userOpenedDiscussionAlwaysSelectsDiscuss() {
        assertEquals(InteractionMode.DISCUSS,
                InteractionModeSelector.select(true, 0));
        assertEquals(InteractionMode.DISCUSS,
                InteractionModeSelector.select(true, 10));
    }

    @Test
    void rejectsNegativeListenCount() {
        assertThrows(IllegalArgumentException.class,
                () -> InteractionModeSelector.select(false, -1));
    }

    @Test
    void sameInputsProduceSameMode() {
        assertEquals(InteractionModeSelector.select(true, 4),
                InteractionModeSelector.select(true, 4));
        assertEquals(InteractionModeSelector.select(false, 2),
                InteractionModeSelector.select(false, 2));
    }
}
