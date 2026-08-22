package com.virtualcompanion.platform.persistence;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * CRYPTO-REST / S0-17-B: application-layer AES-256-GCM cipher for chat
 * bodies and high-sensitivity memory summaries at rest. The database only
 * ever sees opaque strings — SQL moves them verbatim and never interprets
 * them.
 *
 * <p>Write form (single-write): {@code enc2:<keyId>:<keyVersion>:<base64(iv ||
 * ciphertext+tag)>} with a fresh 96-bit IV per value and a 128-bit tag.
 *
 * <p>Dual-read: {@code enc2} values decrypt with the matching key id/version
 * (current write key or the optional previous key). Legacy {@code enc1:}
 * values decrypt with the previous key when configured, otherwise the
 * current write key. Values without either prefix are legacy plaintext and
 * pass through unchanged so a backfill can catch up.
 *
 * <p>{@link #needsReencrypt} / {@link #reencrypt} are the checkpoint
 * rotation seam: a stored value that is plaintext, {@code enc1}, or
 * {@code enc2} under a non-current key is decrypted and rewritten under the
 * current write key. Conversation summaries are wired through
 * {@code ConversationSummaryService} (S0-32).
 */
public final class RestFieldCipher {

    public static final String DEFAULT_KEY_ID = "default";
    public static final int DEFAULT_KEY_VERSION = 1;

    static final String LEGACY_PREFIX = "enc1:";
    static final String PREFIX = "enc2:";

    private static final int IV_LENGTH_BYTES = 12;
    private static final int TAG_LENGTH_BITS = 128;
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final Pattern KEY_ID = Pattern.compile("[a-z][a-z0-9-]{0,31}");

    private final String writeKeyId;
    private final int writeKeyVersion;
    private final SecretKeySpec writeKey;
    private final Map<String, SecretKeySpec> readKeys;
    private final SecretKeySpec legacyEnc1Key;
    private final SecureRandom random = new SecureRandom();

    public RestFieldCipher(String base64Key) {
        this(DEFAULT_KEY_ID, DEFAULT_KEY_VERSION, base64Key);
    }

    public RestFieldCipher(String keyId, int keyVersion, String base64Key) {
        this(keyId, keyVersion, base64Key, null, 0, null);
    }

    public RestFieldCipher(
            String keyId,
            int keyVersion,
            String base64Key,
            String previousKeyId,
            int previousKeyVersion,
            String previousBase64Key) {
        this.writeKeyId = requireKeyId(keyId);
        this.writeKeyVersion = requireVersion(keyVersion);
        this.writeKey = material(base64Key, "rest encryption key");
        Map<String, SecretKeySpec> keys = new LinkedHashMap<>();
        keys.put(slot(writeKeyId, writeKeyVersion), writeKey);
        SecretKeySpec previous = null;
        if (previousBase64Key != null && !previousBase64Key.isBlank()) {
            String prevId = previousKeyId == null || previousKeyId.isBlank()
                    ? writeKeyId
                    : requireKeyId(previousKeyId);
            int prevVersion = previousKeyVersion <= 0 ? writeKeyVersion - 1 : previousKeyVersion;
            if (prevVersion <= 0) {
                throw new IllegalStateException(
                        "previous rest encryption key version must be a positive integer");
            }
            if (prevId.equals(writeKeyId) && prevVersion == writeKeyVersion) {
                throw new IllegalStateException(
                        "previous rest encryption key must differ from the write key");
            }
            previous = material(previousBase64Key, "previous rest encryption key");
            keys.put(slot(prevId, prevVersion), previous);
        }
        this.readKeys = Map.copyOf(keys);
        this.legacyEnc1Key = previous != null ? previous : writeKey;
    }

    /** Current write prefix, e.g. {@code enc2:default:1:}, for checkpoint scans. */
    public String currentPrefix() {
        return PREFIX + writeKeyId + ":" + writeKeyVersion + ":";
    }

    public String writeKeyId() {
        return writeKeyId;
    }

    public int writeKeyVersion() {
        return writeKeyVersion;
    }

    /** True when the value is already in an encrypted stored form (enc1 or enc2). */
    public static boolean isEncrypted(String stored) {
        return stored != null
                && (stored.startsWith(PREFIX) || stored.startsWith(LEGACY_PREFIX));
    }

    /**
     * True when a checkpoint should rewrite {@code stored} under the current
     * write key. Malformed {@code enc2} values fail closed rather than looking
     * like plaintext.
     */
    public boolean needsReencrypt(String stored) {
        if (stored == null) {
            return false;
        }
        if (stored.startsWith(PREFIX)) {
            ParsedEnc2 parsed = parseEnc2(stored);
            return !slot(writeKeyId, writeKeyVersion).equals(slot(parsed.keyId, parsed.version));
        }
        return true;
    }

    /** Encrypt one plaintext into the current {@code enc2:} write form. */
    public String encrypt(String plaintext) {
        Objects.requireNonNull(plaintext, "plaintext must not be null");
        return seal(plaintext);
    }

    /**
     * Decrypt a stored value. Dual-read: {@code enc2} uses the matching key
     * id/version; {@code enc1} uses the previous key when configured, else
     * the write key; anything else is legacy plaintext.
     */
    public String decrypt(String stored) {
        if (stored == null) {
            return null;
        }
        if (stored.startsWith(PREFIX)) {
            ParsedEnc2 parsed = parseEnc2(stored);
            SecretKeySpec key = readKeys.get(slot(parsed.keyId, parsed.version));
            if (key == null) {
                throw new IllegalStateException(
                        "stored rest cipher references an unknown key id/version");
            }
            return open(parsed.payload, key);
        }
        if (stored.startsWith(LEGACY_PREFIX)) {
            byte[] payload;
            try {
                payload = Base64.getDecoder().decode(stored.substring(LEGACY_PREFIX.length()));
            } catch (IllegalArgumentException e) {
                throw new IllegalStateException("stored rest cipher is malformed", e);
            }
            return open(payload, legacyEnc1Key);
        }
        return stored;
    }

    /**
     * Checkpoint rewrite: decrypt then encrypt under the current write key.
     * Current {@code enc2} values are returned unchanged (no IV churn).
     */
    public String reencrypt(String stored) {
        if (stored == null || !needsReencrypt(stored)) {
            return stored;
        }
        return encrypt(decrypt(stored));
    }

    /**
     * Pre-S0-17-B {@code enc1:} form under this instance's write key. Production
     * writes never use this after the enc2 cutover; dual-read tests need a
     * real enc1 blob produced by the shipped GCM path.
     */
    String encryptLegacyEnc1(String plaintext) {
        Objects.requireNonNull(plaintext, "plaintext must not be null");
        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, writeKey, new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] stored = new byte[iv.length + sealed.length];
            System.arraycopy(iv, 0, stored, 0, iv.length);
            System.arraycopy(sealed, 0, stored, iv.length, sealed.length);
            return LEGACY_PREFIX + Base64.getEncoder().encodeToString(stored);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("rest field encryption failed", e);
        }
    }

    private String seal(String plaintext) {
        try {
            byte[] iv = new byte[IV_LENGTH_BYTES];
            random.nextBytes(iv);
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, writeKey, new GCMParameterSpec(TAG_LENGTH_BITS, iv));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] stored = new byte[iv.length + sealed.length];
            System.arraycopy(iv, 0, stored, 0, iv.length);
            System.arraycopy(sealed, 0, stored, iv.length, sealed.length);
            return currentPrefix() + Base64.getEncoder().encodeToString(stored);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("rest field encryption failed", e);
        }
    }

    private String open(byte[] storedBytes, SecretKeySpec key) {
        if (storedBytes.length <= IV_LENGTH_BYTES) {
            throw new IllegalStateException("stored rest cipher is truncated");
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    key,
                    new GCMParameterSpec(TAG_LENGTH_BITS, storedBytes, 0, IV_LENGTH_BYTES));
            byte[] plain = cipher.doFinal(
                    storedBytes, IV_LENGTH_BYTES, storedBytes.length - IV_LENGTH_BYTES);
            return new String(plain, StandardCharsets.UTF_8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(
                    "stored rest cipher failed the integrity check", e);
        }
    }

    private static ParsedEnc2 parseEnc2(String stored) {
        // enc2:<keyId>:<version>:<payload>
        String rest = stored.substring(PREFIX.length());
        int first = rest.indexOf(':');
        int second = first < 0 ? -1 : rest.indexOf(':', first + 1);
        if (first <= 0 || second <= first + 1 || second == rest.length() - 1) {
            throw new IllegalStateException("stored rest cipher is malformed");
        }
        String keyId = rest.substring(0, first);
        String versionText = rest.substring(first + 1, second);
        String payloadText = rest.substring(second + 1);
        if (!KEY_ID.matcher(keyId).matches()) {
            throw new IllegalStateException("stored rest cipher is malformed");
        }
        int version;
        try {
            version = Integer.parseInt(versionText);
        } catch (NumberFormatException e) {
            throw new IllegalStateException("stored rest cipher is malformed", e);
        }
        if (version <= 0) {
            throw new IllegalStateException("stored rest cipher is malformed");
        }
        byte[] payload;
        try {
            payload = Base64.getDecoder().decode(payloadText);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("stored rest cipher is malformed", e);
        }
        return new ParsedEnc2(keyId, version, payload);
    }

    private static String requireKeyId(String keyId) {
        Objects.requireNonNull(keyId, "keyId");
        String normalized = keyId.trim().toLowerCase(Locale.ROOT);
        if (!KEY_ID.matcher(normalized).matches()) {
            throw new IllegalStateException(
                    "rest encryption key id must match [a-z][a-z0-9-]{0,31}");
        }
        return normalized;
    }

    private static int requireVersion(int version) {
        if (version <= 0) {
            throw new IllegalStateException(
                    "rest encryption key version must be a positive integer");
        }
        return version;
    }

    private static String slot(String keyId, int version) {
        return keyId + ":" + version;
    }

    private static SecretKeySpec material(String base64Key, String label) {
        Objects.requireNonNull(base64Key, label + " must not be null");
        byte[] keyBytes;
        try {
            keyBytes = Base64.getDecoder().decode(base64Key);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(label + " is not valid base64", e);
        }
        if (keyBytes.length != 32) {
            throw new IllegalStateException(
                    label + " must be 32 bytes (AES-256), got " + keyBytes.length);
        }
        return new SecretKeySpec(keyBytes, "AES");
    }

    private record ParsedEnc2(String keyId, int version, byte[] payload) {}
}
