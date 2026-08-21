package com.virtualcompanion.modelruntime.contract;

import java.util.Objects;

/**
 * Provider-neutral request and response size limits.
 */
public final class SizeLimits {

    public static final int MAX_MESSAGES = 64;
    public static final int MAX_MESSAGE_BYTES = 64 * 1024;
    public static final int MAX_SCHEMA_BYTES = 16 * 1024;
    public static final int MAX_STREAM_EVENT_BYTES = 1024 * 1024;
    public static final int MAX_TOTAL_OUTPUT_BYTES = 1024 * 1024;
    public static final int MAX_OPENAI_OUTPUT_TOKENS = 8192;
    public static final int MAX_NON_STREAM_RESPONSE_BODY_BYTES = 8 * 1024 * 1024;

    private SizeLimits() {
    }

    public static long utf8Bytes(String value) {
        Objects.requireNonNull(value, "value must not be null");
        long bytes = 0;
        for (int index = 0; index < value.length(); index++) {
            char current = value.charAt(index);
            if (current <= 0x7f) {
                bytes++;
            } else if (current <= 0x7ff) {
                bytes += 2;
            } else if (Character.isHighSurrogate(current)
                    && index + 1 < value.length()
                    && Character.isLowSurrogate(value.charAt(index + 1))) {
                bytes += 4;
                index++;
            } else if (Character.isSurrogate(current)) {
                // Isolated (malformed) surrogates count as ONE byte here,
                // deliberately below the UTF-8 encoder's actual 3-byte
                // U+FFFD replacement; streaming consumers re-adjust the
                // boundary when adjacent deltas complete a pair (see
                // AnthropicMessagesSession.addOutputBytes).
                bytes++;
            } else {
                bytes += 3;
            }
        }
        return bytes;
    }

    public static void requireWithin(String field, long actual, long maximum) {
        Objects.requireNonNull(field, "field must not be null");
        if (actual < 0 || maximum < 0) {
            throw new IllegalArgumentException("size values must not be negative");
        }
        if (actual > maximum) {
            throw new IllegalArgumentException(field + " exceeds configured limit");
        }
    }
}
