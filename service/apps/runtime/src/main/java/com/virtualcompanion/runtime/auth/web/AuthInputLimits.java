package com.virtualcompanion.runtime.auth.web;

import java.nio.charset.StandardCharsets;

/**
 * Byte limits for the HTTP-facing identity inputs. Character limits remain on
 * the request records; these limits protect the direct service path before
 * BCrypt, hashing or JDBC work begins.
 */
public final class AuthInputLimits {

    public static final int MAX_REQUEST_BODY_BYTES = 16_384;
    public static final int MAX_USERNAME_UTF8_BYTES = 512;
    public static final int MAX_PASSWORD_UTF8_BYTES = 4_096;
    public static final int MAX_DISPLAY_NAME_UTF8_BYTES = 1_024;
    public static final int MAX_ROLE_UTF8_BYTES = 64;
    public static final int MAX_REFRESH_TOKEN_UTF8_BYTES = 512;

    private AuthInputLimits() {
    }

    /** Returns the UTF-8 encoded size; null is treated as an absent value. */
    public static int utf8ByteLength(String value) {
        return value == null ? 0 : value.getBytes(StandardCharsets.UTF_8).length;
    }

    /** Null remains the responsibility of the required/optional field rules. */
    public static boolean withinUtf8Bytes(String value, int maximumBytes) {
        if (maximumBytes < 0) {
            throw new IllegalArgumentException("maximumBytes must not be negative");
        }
        if (value == null) {
            return true;
        }
        // Avoid allocating a second attacker-sized byte array when the Java
        // string alone already proves that the UTF-8 limit is exceeded.
        return value.length() <= maximumBytes && utf8ByteLength(value) <= maximumBytes;
    }
}
