package com.virtualcompanion.modelopenai;

/**
 * Body-free protocol parse signal. Provider content is never attached to the
 * exception message or cause.
 */
final class OpenAiCodecException extends Exception {

    OpenAiCodecException() {
        super("OpenAI Chat Completions payload failed validation");
    }
}
