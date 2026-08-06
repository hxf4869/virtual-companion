package com.virtualcompanion.modelruntime.routing;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Deterministic SHA-256 hex digest over canonical UTF-8 input.
 *
 * <p>Package-private audit helper. Route decision numbers, synthetic provider
 * attempt ids and quota reservation ids are all derived deterministically from
 * stable structural inputs, so the same routing context always yields the same
 * auditable identifier. A random UUID, sequence counter or wall-clock value is
 * never used — that would make the routing outcome non-reproducible.
 */
final class DecisionHash {

    private DecisionHash() {
    }

    static String hex(String canonical) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(canonical.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(Character.forDigit((b >> 4) & 0xF, 16));
                sb.append(Character.forDigit(b & 0xF, 16));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }
}
