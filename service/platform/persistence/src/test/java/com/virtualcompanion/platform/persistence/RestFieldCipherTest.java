package com.virtualcompanion.platform.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/**
 * CRYPTO-REST / S0-17-B: the at-rest cipher single-writes enc2 with key
 * id/version, dual-reads enc1 and previous enc2, passes legacy plaintext
 * through on decrypt, fail-closes on unknown keys, and re-encrypts at a
 * checkpoint without touching conversation_summary.
 */
class RestFieldCipherTest {

    private static final String KEY = "ZGV2LW9ubHktYWxwaGEta2V5LWRvLW5vdC11c2UtaW4=";
    private static final String OTHER_KEY = "MW4ybjNuNHI1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmM=";

    @Test
    void roundTripRecoversPlaintextAsEnc2() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        String stored = cipher.encrypt("drill-message-plaintext");
        assertThat(stored).startsWith("enc2:default:1:");
        assertThat(cipher.decrypt(stored)).isEqualTo("drill-message-plaintext");
        assertThat(cipher.needsReencrypt(stored)).isFalse();
    }

    @Test
    void storedFormCarriesPrefixAndFreshIv() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        String a = cipher.encrypt("same text");
        String b = cipher.encrypt("same text");

        assertThat(a).startsWith("enc2:default:1:").isNotEqualTo(b);
    }

    @Test
    void legacyPlaintextPassesThroughDecryptAndNeedsReencrypt() {
        RestFieldCipher cipher = new RestFieldCipher(KEY);

        assertThat(cipher.decrypt("pre-encryption row")).isEqualTo("pre-encryption row");
        assertThat(cipher.decrypt(null)).isNull();
        assertThat(cipher.needsReencrypt("pre-encryption row")).isTrue();
        assertThat(cipher.needsReencrypt(null)).isFalse();
    }

    @Test
    void dualReadDecryptsLegacyEnc1ThenCheckpointRewritesEnc2() {
        RestFieldCipher original = new RestFieldCipher(KEY);
        String enc1 = original.encryptLegacyEnc1("legacy-body");
        assertThat(enc1).startsWith("enc1:");

        RestFieldCipher upgraded = new RestFieldCipher("default", 1, KEY);
        assertThat(upgraded.decrypt(enc1)).isEqualTo("legacy-body");
        assertThat(upgraded.needsReencrypt(enc1)).isTrue();

        String rewritten = upgraded.reencrypt(enc1);
        assertThat(rewritten).startsWith("enc2:default:1:");
        assertThat(upgraded.decrypt(rewritten)).isEqualTo("legacy-body");
        assertThat(upgraded.needsReencrypt(rewritten)).isFalse();
        assertThat(upgraded.reencrypt(rewritten)).isEqualTo(rewritten);
    }

    @Test
    void dualReadUsesPreviousKeyForEnc1AndPreviousEnc2AfterRotation() {
        RestFieldCipher v1 = new RestFieldCipher("k", 1, KEY);
        String enc1 = v1.encryptLegacyEnc1("rotated-body");
        String enc2v1 = v1.encrypt("rotated-body");

        RestFieldCipher v2 = new RestFieldCipher("k", 2, OTHER_KEY, "k", 1, KEY);
        assertThat(v2.decrypt(enc1)).isEqualTo("rotated-body");
        assertThat(v2.decrypt(enc2v1)).isEqualTo("rotated-body");
        assertThat(v2.needsReencrypt(enc2v1)).isTrue();
        assertThat(v2.reencrypt(enc2v1)).startsWith("enc2:k:2:");
        assertThat(v2.decrypt(v2.encrypt("fresh"))).isEqualTo("fresh");
    }

    @Test
    void unknownKeyIdOrVersionFailsClosed() {
        RestFieldCipher writer = new RestFieldCipher("alpha", 1, KEY);
        String stored = writer.encrypt("secret");
        RestFieldCipher other = new RestFieldCipher("beta", 1, KEY);

        assertThatThrownBy(() -> other.decrypt(stored))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("unknown key");
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
        RestFieldCipher writer = new RestFieldCipher(KEY);
        RestFieldCipher reader = new RestFieldCipher(OTHER_KEY);

        assertThatThrownBy(() -> reader.decrypt(writer.encrypt("secret")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void currentPrefixIsTheWriteSlot() {
        RestFieldCipher cipher = new RestFieldCipher("ops", 3, KEY);
        assertThat(cipher.currentPrefix()).isEqualTo("enc2:ops:3:");
        assertThat(cipher.writeKeyId()).isEqualTo("ops");
        assertThat(cipher.writeKeyVersion()).isEqualTo(3);
    }
}
