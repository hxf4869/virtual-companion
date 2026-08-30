package com.virtualcompanion.platform.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

/**
 * G3: Java RestFieldCipher decrypts Go-produced enc2/enc1 golden vectors,
 * and the committed Java-produced vectors. Test-only keys; no production
 * credentials.
 */
class GoFieldCipherCompatibilityTest {

    @Test
    void javaDecryptsGoAndJavaEnc2AndEnc1() throws Exception {
        String json = Files.readString(vectorsPath());
        RestFieldCipher cipher = new RestFieldCipher(jsonField(json, "keyBase64"));
        String plaintext = jsonField(json, "plaintext");

        String goEnc2 = jsonField(json, "goEnc2");
        assertThat(goEnc2).startsWith("enc2:default:1:");
        assertThat(cipher.decrypt(goEnc2)).isEqualTo(plaintext);

        String goEnc1 = jsonField(json, "goEnc1");
        assertThat(goEnc1).startsWith("enc1:");
        assertThat(cipher.decrypt(goEnc1)).isEqualTo(plaintext);

        String javaEnc2 = jsonField(json, "javaEnc2");
        assertThat(javaEnc2).startsWith("enc2:default:1:");
        assertThat(cipher.decrypt(javaEnc2)).isEqualTo(plaintext);

        String javaEnc1 = jsonField(json, "javaEnc1");
        assertThat(javaEnc1).startsWith("enc1:");
        assertThat(cipher.decrypt(javaEnc1)).isEqualTo(plaintext);

        assertThat(cipher.decrypt(jsonField(json, "legacyPlaintext")))
                .isEqualTo(jsonField(json, "legacyPlaintext"));
        assertThat(cipher.encrypt(plaintext)).startsWith("enc2:default:1:");
    }

    static String jsonField(String json, String key) {
        String needle = "\"" + key + "\": \"";
        int start = json.indexOf(needle);
        if (start < 0) {
            throw new IllegalStateException("missing " + key);
        }
        start += needle.length();
        int end = json.indexOf('"', start);
        if (end < 0) {
            throw new IllegalStateException("unterminated " + key);
        }
        return json.substring(start, end);
    }

    /** Read a string field from a flat JSON object named {@code parent}. */
    static String nestedString(String json, String parent, String key) {
        int from = json.indexOf("\"" + parent + "\":");
        if (from < 0) {
            throw new IllegalStateException("missing object " + parent);
        }
        int brace = json.indexOf('{', from);
        int close = json.indexOf('}', brace);
        if (brace < 0 || close < 0) {
            throw new IllegalStateException("malformed object " + parent);
        }
        return jsonField(json.substring(brace, close + 1), key);
    }

    static Path vectorsPath() {
        return findRepoRoot().resolve("backend/contracttest/testdata/crypto-vectors.json");
    }

    static Path findRepoRoot() {
        Path dir = Path.of("").toAbsolutePath();
        for (Path current = dir; current != null; current = current.getParent()) {
            if (Files.exists(current.resolve("backend/go.mod"))
                    && Files.exists(current.resolve("AGENTS.md"))) {
                return current;
            }
        }
        throw new IllegalStateException("repo root not found above " + dir);
    }
}
