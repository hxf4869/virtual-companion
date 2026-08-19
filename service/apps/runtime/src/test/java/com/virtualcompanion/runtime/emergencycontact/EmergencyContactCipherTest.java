package com.virtualcompanion.runtime.emergencycontact;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.Base64;
import org.junit.jupiter.api.Test;

/**
 * EMERGENCY-CONTACT: the application-layer AES-256-GCM cipher (§17.4) —
 * roundtrip, fresh IV per encryption, integrity failure on tamper, and key
 * validation.
 */
class EmergencyContactCipherTest {

    private static final String KEY_32 = Base64.getEncoder()
            .encodeToString(new byte[32]);

    @Test
    void encryptDecryptRoundTrips() {
        EmergencyContactCipher cipher = new EmergencyContactCipher(KEY_32);
        String stored = cipher.encrypt("+86 138 0000 0000");
        assertEquals("+86 138 0000 0000", cipher.decrypt(stored));
    }

    @Test
    void eachEncryptionUsesAFreshIv() {
        EmergencyContactCipher cipher = new EmergencyContactCipher(KEY_32);
        assertNotEquals(cipher.encrypt("same"), cipher.encrypt("same"));
    }

    @Test
    void tamperedStoreFailsTheIntegrityCheck() {
        EmergencyContactCipher cipher = new EmergencyContactCipher(KEY_32);
        byte[] stored = Base64.getDecoder().decode(cipher.encrypt("secret"));
        stored[stored.length - 1] ^= 0x01;
        String tampered = Base64.getEncoder().encodeToString(stored);
        assertThrows(IllegalStateException.class, () -> cipher.decrypt(tampered));
    }

    @Test
    void wrongKeyCannotDecrypt() {
        String stored = new EmergencyContactCipher(KEY_32).encrypt("secret");
        byte[] different = new byte[32];
        different[0] = 1;
        EmergencyContactCipher other = new EmergencyContactCipher(
                Base64.getEncoder().encodeToString(different));
        assertThrows(IllegalStateException.class, () -> other.decrypt(stored));
    }

    @Test
    void keyMustBeBase64And32Bytes() {
        assertThrows(IllegalStateException.class,
                () -> new EmergencyContactCipher("not-base64!!"));
        assertThrows(IllegalStateException.class,
                () -> new EmergencyContactCipher(Base64.getEncoder().encodeToString(new byte[16])));
    }
}
