package com.virtualcompanion.platform.persistence;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * CRYPTO-REST (§16.5/§17.4): application-layer AES-256-GCM cipher for chat
 * bodies at rest. The database only ever sees opaque strings — SQL moves
 * them verbatim and never interprets them.
 *
 * <p>Stored form: {@code enc1:<base64(iv || ciphertext+tag)>} with a fresh
 * 96-bit IV per value and a 128-bit tag (the V65 emergency-contact scheme,
 * generalized). {@link #decrypt} passes values through unchanged when they
 * lack the {@code enc1:} prefix, so rows written before encryption was
 * enabled keep reading while the one-shot backfill catches up.
 */
public final class RestFieldCipher {

    private static final String PREFIX = "enc1:";
    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public RestFieldCipher(String base64Key) {
        Objects.requireNonNull(base64Key, "base64Key must not be null");
        byte[] keyBytes;
        try {
            keyBytes = Base64.getDecoder().decode(base64Key);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("rest encryption key is not valid base64", e);
        }
        if (keyBytes.length != 32) {
            throw new IllegalStateException(
                    "rest encryption key must be 32 bytes (AES-256), got " + keyBytes.length);
        }
        this.key = new SecretKeySpec(keyBytes, "AES");
    }

    /** True when the value is already in the encrypted stored form. */
    public static boolean isEncrypted(String stored) {
        return stored != null && stored.startsWith(PREFIX);
    }

    /** Encrypt one plaintext into {@code enc1:<base64(iv || ciphertext+tag)>}. */
    public String encrypt(String plaintext) {
        Objects.requireNonNull(plaintext, "plaintext must not be null");
        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] stored = new byte[iv.length + sealed.length];
            System.arraycopy(iv, 0, stored, 0, iv.length);
            System.arraycopy(sealed, 0, stored, iv.length, sealed.length);
            return PREFIX + Base64.getEncoder().encodeToString(stored);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("rest field encryption failed", e);
        }
    }

    /**
     * Decrypt a stored value. Values without the {@code enc1:} prefix are
     * legacy plaintext and pass through unchanged (backfill compatibility).
     */
    public String decrypt(String stored) {
        if (stored == null || !isEncrypted(stored)) {
            return stored;
        }
        byte[] storedBytes;
        try {
            storedBytes = Base64.getDecoder().decode(
                    stored.substring(PREFIX.length()));
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("stored rest cipher is malformed", e);
        }
        if (storedBytes.length <= IV_LENGTH_BYTES) {
            throw new IllegalStateException("stored rest cipher is truncated");
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(TAG_LENGTH_BITS, storedBytes, 0, IV_LENGTH_BYTES));
            byte[] plain = cipher.doFinal(storedBytes, IV_LENGTH_BYTES,
                    storedBytes.length - IV_LENGTH_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(
                    "stored rest cipher failed the integrity check", e);
        }
    }
}
