package com.virtualcompanion.runtime.auth.jwt;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

/**
 * G3: Java JwtTokenService verifies Go-compact HMAC tokens and the committed
 * Java-issued golden token. BCrypt hashes from Go verify with Spring's encoder.
 * Java remains the only production issuer; this test is verification only.
 */
public class GoJwtCompatibilityTest {

    @Test
    void javaVerifierAcceptsGoAndJavaGoldenTokens() throws Exception {
        String json = Files.readString(vectorsPath());
        JwtTokenService service = new JwtTokenService(
                nestedString(json, "jwt", "secret"),
                Duration.ofHours(2),
                nestedString(json, "jwt", "issuer"));

        JwtTokenService.Principal fromGo = service.verifyAccessToken(nestedString(json, "jwt", "goToken"));
        assertThat(fromGo).isNotNull();
        assertThat(fromGo.accountId()).isEqualTo(1001L);
        assertThat(fromGo.role()).isEqualTo("USER");
        assertThat(fromGo.username()).isEqualTo("alice");
        assertThat(fromGo.sessionEpoch()).isEqualTo(4L);

        JwtTokenService.Principal fromJava = service.verifyAccessToken(nestedString(json, "jwt", "javaToken"));
        assertThat(fromJava).isNotNull();
        assertThat(fromJava.accountId()).isEqualTo(1001L);
        assertThat(fromJava.sessionEpoch()).isEqualTo(4L);
    }

    @Test
    void springBcryptAcceptsGoAndJavaHashes() throws Exception {
        String json = Files.readString(vectorsPath());
        BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();
        String password = nestedString(json, "bcrypt", "password");
        assertThat(encoder.matches(password, nestedString(json, "bcrypt", "goHash"))).isTrue();
        assertThat(encoder.matches(password, nestedString(json, "bcrypt", "javaHash"))).isTrue();
        assertThat(encoder.matches("wrong-password", nestedString(json, "bcrypt", "goHash"))).isFalse();
    }

    public static String jsonField(String json, String key) {
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

    public static String nestedString(String json, String parent, String key) {
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

    public static Path vectorsPath() {
        Path dir = Path.of("").toAbsolutePath();
        for (Path current = dir; current != null; current = current.getParent()) {
            if (Files.exists(current.resolve("backend/go.mod"))
                    && Files.exists(current.resolve("AGENTS.md"))) {
                return current.resolve("backend/contracttest/testdata/crypto-vectors.json");
            }
        }
        throw new IllegalStateException("repo root not found above " + dir);
    }
}
