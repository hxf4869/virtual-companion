package com.virtualcompanion.platform.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * CRYPTO-REST: the at-rest cipher round-trips, marks its stored form, passes
 * legacy plaintext through on decrypt, and fails closed on tampering.
 */
class RestFieldCipherTest {

    private static final String KEY = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=";

    @Test
    void roundTripRecoversPlaintext() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        assertThat(cipher.decrypt(cipher.encrypt("drill-message-plaintext")))
                .isEqualTo("drill-message-plaintext");
    }

    @Test
    void storedFormCarriesPrefixAndFreshIv() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        String a = cipher.encrypt("same text");
        String b = cipher.encrypt("same text");

        assertThat(a).startsWith("enc1:").isNotEqualTo(b);
    }

    @Test
    void legacyPlaintextPassesThroughDecrypt() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        assertThat(cipher.decrypt("pre-encryption row")).isEqualTo("pre-encryption row");
        assertThat(cipher.decrypt(null)).isNull();
    }

    @Test
    void tamperedStoredValueFailsIntegrity() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        String sealed = cipher.encrypt("secret");
        String tampered = sealed.substring(0, sealed.length() - 2) + "AA";

        assertThatThrownBy(() -> cipher.decrypt(tampered))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void wrongKeyFailsIntegrity() {
        String otherKey = "MW4ybjNuNHI1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmM=";
        RestFieldCipher writer = new RestFieldCipher(KEY);
        RestFieldCipher reader = new RestFieldCipher(otherKey);

        assertThatThrownBy(() -> reader.decrypt(writer.encrypt("secret")))
                .isInstanceOf(IllegalStateException.class);
    }
}
