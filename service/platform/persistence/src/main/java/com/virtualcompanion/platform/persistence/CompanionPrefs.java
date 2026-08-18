package com.virtualcompanion.platform.persistence;

import java.util.List;

/**
 * Structured Companion configuration (COMP-CFG FR-COMP-003 + COMP-PRES
 * FR-COMP-002). Catalog codes only; display names are labels, never free-form
 * prompt text. gender/avatarRef are presentation-only fields: every companion
 * stays an adult role (fixed) and avatars must reference the platform-curated
 * companion-presentation catalog (no photo upload in v1).
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
        List<String> avoidTopics,
        String gender,
        String avatarRef) {

    public static final String DEFAULT_REPLY_LENGTH = "MEDIUM";
    public static final String DEFAULT_INITIATIVE = "LOW";
    public static final String DEFAULT_HUMOR = "LIGHT";
    public static final String DEFAULT_ADVICE = "ASK_FIRST";
    public static final String DEFAULT_MEMORY_SHARE = "RELATIONSHIP";
    public static final String DEFAULT_GENDER = "NEUTRAL";
    public static final String DEFAULT_AVATAR = "AVATAR_NEUTRAL_01";

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
        if (gender == null || gender.isBlank()) {
            throw new IllegalArgumentException("gender must not be blank");
        }
        if (avatarRef == null || avatarRef.isBlank()) {
            throw new IllegalArgumentException("avatarRef must not be blank");
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
                List.of(),
                DEFAULT_GENDER,
                DEFAULT_AVATAR);
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
