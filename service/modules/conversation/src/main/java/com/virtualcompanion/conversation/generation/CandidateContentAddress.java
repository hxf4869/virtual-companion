package com.virtualcompanion.conversation.generation;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * Deterministic content addressing for frozen generation candidates.
 */
public final class CandidateContentAddress {

    private CandidateContentAddress() {
    }

    /**
     * Returns lowercase hex SHA-256(type + NUL + UTF-8 content).
     */
    public static String sha256(CandidateContent content) {
        ConversationChecks.requireNonNull(content, "content");
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            digest.update(content.type().addressTag().getBytes(StandardCharsets.UTF_8));
            digest.update((byte) 0);
            return HexFormat.of().formatHex(
                    digest.digest(content.value().getBytes(StandardCharsets.UTF_8))
            );
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }
}
