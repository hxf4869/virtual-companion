package com.virtualcompanion.safety;

import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * Deterministic natural-language exit-intent detection (NL-EXIT, §21.3.4).
 *
 * <p>When the caller expresses a wish to stop the conversation in natural
 * language, the turn must stop immediately: no new generation, no in-flight
 * streaming, no retention wording. Detection is a fixed high-precision
 * phrase set (case-insensitive ASCII fold; Chinese exact substrings) — a
 * miss simply flows into the normal pipeline, so recall deliberately yields
 * to precision here. A safety input block always takes precedence over an
 * exit match (§20.5 priority); the caller checks safety first.
 */
public final class ExitIntentDetector {

    /** The rule id recorded on the cancel path's audit trail. */
    public static final String RULE_ID = "nl-exit-request";

    private static final List<String> EXIT_PHRASES = List.of(
            "不想聊了", "不聊了", "结束对话", "到此为止", "别说了", "我不想继续了",
            "stop the conversation", "end the conversation", "i don't want to talk");

    private ExitIntentDetector() {
    }

    /** True when the text expresses a stop-the-conversation intent. */
    public static boolean isExitIntent(String text) {
        Objects.requireNonNull(text, "text must not be null");
        String haystack = text.toLowerCase(Locale.ROOT);
        for (String phrase : EXIT_PHRASES) {
            if (haystack.contains(phrase.toLowerCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }
}
