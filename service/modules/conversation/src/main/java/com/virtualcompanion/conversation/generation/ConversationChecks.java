package com.virtualcompanion.conversation.generation;

import java.util.Objects;

final class ConversationChecks {

    private ConversationChecks() {
    }

    static <T> T requireNonNull(T value, String name) {
        return Objects.requireNonNull(value, name + " must not be null");
    }

    static String requireNonBlank(String value, String name) {
        requireNonNull(value, name);
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }

    static String requireNonEmpty(String value, String name) {
        requireNonNull(value, name);
        if (value.isEmpty()) {
            throw new IllegalArgumentException(name + " must not be empty");
        }
        return value;
    }

    static long requireNonNegative(long value, String name) {
        if (value < 0) {
            throw new IllegalArgumentException(name + " must not be negative");
        }
        return value;
    }
}
