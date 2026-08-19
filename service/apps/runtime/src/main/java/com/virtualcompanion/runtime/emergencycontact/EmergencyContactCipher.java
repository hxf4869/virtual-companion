package com.virtualcompanion.runtime.emergencycontact;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Application-layer AES-256-GCM cipher for the emergency contact value
 * (§17.4 聊天正文、紧急联系人和高敏记忆应用层加密).
 *
 * <p>The stored form is {@code base64(iv || ciphertext+tag)} with a fresh
 * random 96-bit IV per encryption and a 128-bit tag. The key comes from
 * deployment configuration and is never persisted. A tampered or otherwise
 * unreadable stored value fails the GCM integrity check on decrypt —
 * surfaced as {@link IllegalStateException} (a data-integrity problem, not a
 * client error).
 */
public final class EmergencyContactCipher {

    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public EmergencyContactCipher(String base64Key) {
        Objects.requireNonNull(base64Key, "base64Key must not be null");
        byte[] keyBytes;
        try {
            keyBytes = Base64.getDecoder().decode(base64Key);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "emergency contact encryption key is not valid base64", e);
        }
        if (keyBytes.length != 32) {
            throw new IllegalStateException(
                    "emergency contact encryption key must be 32 bytes (AES-256), got "
                            + keyBytes.length);
        }
        this.key = new SecretKeySpec(keyBytes, "AES");
    }

    /** Encrypt one contact value into {@code base64(iv || ciphertext+tag)}. */
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
            return Base64.getEncoder().encodeToString(stored);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("emergency contact encryption failed", e);
        }
    }

    /** Decrypt a stored value; a tampered store fails the integrity check. */
    public String decrypt(String stored) {
        Objects.requireNonNull(stored, "stored must not be null");
        byte[] storedBytes;
        try {
            storedBytes = Base64.getDecoder().decode(stored);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("stored contact cipher is malformed", e);
        }
        if (storedBytes.length <= IV_LENGTH_BYTES) {
            throw new IllegalStateException("stored contact cipher is truncated");
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
                    "stored contact cipher failed the integrity check", e);
        }
    }
}
