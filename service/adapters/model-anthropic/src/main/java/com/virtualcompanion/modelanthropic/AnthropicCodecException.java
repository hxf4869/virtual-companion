package com.virtualcompanion.modelanthropic;

/**
 * Strict Anthropic Messages JSON/SSE parse signal. Carries no response body so
 * that no provider detail crosses the neutral failure boundary.
 */
final class AnthropicCodecException extends Exception {

    AnthropicCodecException() {
        super("anthropic messages codec failure", null, false, false);
    }
}
