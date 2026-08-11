package com.virtualcompanion.runtime.auth.web;

import java.nio.CharBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;

/**
 * Byte limits for the HTTP-facing identity inputs. Character limits remain on
 * the request records; these limits protect the direct service path before
 * BCrypt, hashing or JDBC work begins.
 */
public final class AuthInputLimits {

    public static final int MAX_REQUEST_BODY_BYTES = 65_536;
    public static final int MAX_USERNAME_UTF8_BYTES = 64;
    public static final int MAX_PASSWORD_UTF8_BYTES = 128;
    public static final int MAX_DISPLAY_NAME_UTF8_BYTES = 1_024;
    public static final int MAX_ROLE_UTF8_BYTES = 64;
    public static final int MAX_REFRESH_TOKEN_UTF8_BYTES = 512;

    private AuthInputLimits() {
    }

    /** Returns the UTF-8 encoded size; null is treated as an absent value. */
    public static int utf8ByteLength(String value) {
        if (value == null) {
            return 0;
        }
        try {
            return StandardCharsets.UTF_8.newEncoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .encode(CharBuffer.wrap(value))
                    .remaining();
        } catch (CharacterCodingException e) {
            throw new IllegalArgumentException("value is not valid UTF-8", e);
        }
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
        if (value.length() > maximumBytes) {
            return false;
        }
        try {
            return utf8ByteLength(value) <= maximumBytes;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
