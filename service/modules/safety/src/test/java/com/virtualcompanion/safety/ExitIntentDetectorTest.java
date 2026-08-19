package com.virtualcompanion.safety;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link ExitIntentDetector} (NL-EXIT / §21.3.4): the fixed
 * high-precision phrase floor — hits stop the turn, misses flow normally.
 */
class ExitIntentDetectorTest {

    @Test
    void detectsChineseExitPhrases() {
        assertTrue(ExitIntentDetector.isExitIntent("今天很累，我不想聊了"));
        assertTrue(ExitIntentDetector.isExitIntent("别说了，我想静一静"));
        assertTrue(ExitIntentDetector.isExitIntent("我们到此为止吧"));
    }

    @Test
    void detectsEnglishExitPhrasesCaseInsensitively() {
        assertTrue(ExitIntentDetector.isExitIntent("Please STOP THE CONVERSATION"));
        assertTrue(ExitIntentDetector.isExitIntent("I don't want to talk anymore"));
    }

    @Test
    void normalConversationDoesNotTripTheDetector() {
        assertFalse(ExitIntentDetector.isExitIntent("今天上班好累，想找人说说话"));
        assertFalse(ExitIntentDetector.isExitIntent("聊聊周末的安排吧"));
        assertFalse(ExitIntentDetector.isExitIntent(""));
    }

    @Test
    void crisisWordingIsNotAnExitMatch() {
        // A crisis message must fall through to the safety input check, which
        // takes precedence over exit handling (§20.5 priority).
        assertFalse(ExitIntentDetector.isExitIntent("我不想活了"));
    }
}
