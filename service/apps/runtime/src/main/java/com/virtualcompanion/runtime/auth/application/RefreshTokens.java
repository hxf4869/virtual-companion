package com.virtualcompanion.runtime.auth.application;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * Refresh-token material helpers. The raw token is 256 bits of
 * {@link SecureRandom} entropy, Base64-url encoded without padding; only its
 * sha256 hex digest is persisted (V14), so a database leak cannot recover a
 * usable refresh token. Uses the JDK crypto/hash primitives directly -- the
 * approved gate forbids self-written cryptography, not standard-library usage.
 */
public final class RefreshTokens {

    private static final SecureRandom RANDOM = new SecureRandom();

    private RefreshTokens() {
    }

    /** Generate a new 256-bit refresh token (Base64-url, no padding). */
    public static String generate() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /** Hex sha256 digest of a raw refresh token -- the only form stored. */
    public static String sha256Hex(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new IllegalArgumentException("rawToken is required");
        }
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(rawToken.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 must be available on the JVM", e);
        }
    }
}
