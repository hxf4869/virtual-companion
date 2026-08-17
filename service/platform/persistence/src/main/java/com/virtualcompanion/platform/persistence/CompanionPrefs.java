package com.virtualcompanion.platform.persistence;

import java.util.List;

/**
 * Structured Companion preferences (COMP-CFG / FR-COMP-003). Catalog codes
 * only; display names are labels, never free-form prompt text.
 */
public record CompanionPrefs(
        String companionName,
        String userAddressAs,
        String replyLength,
        String initiative,
        String humor,
        String advicePref,
        boolean remindersAllowed,
        String memoryShareScope,
        List<String> avoidTopics) {

    public static final String DEFAULT_REPLY_LENGTH = "MEDIUM";
    public static final String DEFAULT_INITIATIVE = "LOW";
    public static final String DEFAULT_HUMOR = "LIGHT";
    public static final String DEFAULT_ADVICE = "ASK_FIRST";
    public static final String DEFAULT_MEMORY_SHARE = "RELATIONSHIP";

    public CompanionPrefs {
        if (replyLength == null || replyLength.isBlank()) {
            throw new IllegalArgumentException("replyLength must not be blank");
        }
        if (initiative == null || initiative.isBlank()) {
            throw new IllegalArgumentException("initiative must not be blank");
        }
        if (humor == null || humor.isBlank()) {
            throw new IllegalArgumentException("humor must not be blank");
        }
        if (advicePref == null || advicePref.isBlank()) {
            throw new IllegalArgumentException("advicePref must not be blank");
        }
        if (memoryShareScope == null || memoryShareScope.isBlank()) {
            throw new IllegalArgumentException("memoryShareScope must not be blank");
        }
        avoidTopics = List.copyOf(avoidTopics == null ? List.of() : avoidTopics);
    }

    public static CompanionPrefs defaults() {
        return new CompanionPrefs(
                null,
                null,
                DEFAULT_REPLY_LENGTH,
                DEFAULT_INITIATIVE,
                DEFAULT_HUMOR,
                DEFAULT_ADVICE,
                false,
                DEFAULT_MEMORY_SHARE,
                List.of());
    }

    public String avoidTopicsCsv() {
        return String.join(",", avoidTopics);
    }

    public static List<String> splitAvoidTopics(String csv) {
        if (csv == null || csv.isBlank()) {
            return List.of();
        }
        return List.of(csv.split(","));
    }
}
