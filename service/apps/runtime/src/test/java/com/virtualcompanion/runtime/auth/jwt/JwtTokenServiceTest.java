package com.virtualcompanion.runtime.auth.jwt;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class JwtTokenServiceTest {

    private static final String SECRET =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private JwtTokenService service() {
        return new JwtTokenService(SECRET, Duration.ofHours(2), "virtual-companion");
    }

    @Test
    void issuesAndVerifiesAccessTokenWithServerDerivedIdentity() {
        String token = service().issueAccessToken(1001L, "ADMIN", "root");

        JwtTokenService.Principal principal = service().verifyAccessToken(token);

        assertThat(principal).isNotNull();
        assertThat(principal.accountId()).isEqualTo(1001L);
        assertThat(principal.role()).isEqualTo("ADMIN");
        assertThat(principal.username()).isEqualTo("root");
        assertThat(principal.sessionEpoch()).isEqualTo(1L);
    }

    @Test
    void accessTokenCarriesSessionEpoch() {
        String token = service().issueAccessToken(1001L, "USER", "alice", 4L);

        JwtTokenService.Principal principal = service().verifyAccessToken(token);

        assertThat(principal).isNotNull();
        assertThat(principal.sessionEpoch()).isEqualTo(4L);
    }

    @Test
    void rejectsNonPositiveSessionEpoch() {
        assertThatThrownBy(() -> service().issueAccessToken(7L, "USER", "alice", 0L))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsSecretShorterThan256Bits() {
        assertThatThrownBy(() -> new JwtTokenService("short-secret", Duration.ofHours(2), "vc"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("256 bits");
    }

    @Test
    void rejectsNegativeOrZeroAccessTtl() {
        assertThatThrownBy(() -> new JwtTokenService(SECRET, Duration.ZERO, "vc"))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsTamperedToken() {
        String token = service().issueAccessToken(7L, "USER", "alice");
        String tampered = token.substring(0, token.length() - 3) + "xyz";

        assertThat(service().verifyAccessToken(tampered)).isNull();
    }

    @Test
    void rejectsExpiredToken() throws InterruptedException {
        JwtTokenService shortLived = new JwtTokenService(SECRET, Duration.ofNanos(1), "virtual-companion");
        String token = shortLived.issueAccessToken(7L, "USER", "alice");
        Thread.sleep(2);

        assertThat(shortLived.verifyAccessToken(token)).isNull();
    }

    @Test
    void rejectsTokenFromDifferentIssuer() {
        JwtTokenService other = new JwtTokenService(SECRET, Duration.ofHours(2), "other-issuer");
        String token = other.issueAccessToken(7L, "USER", "alice");

        assertThat(service().verifyAccessToken(token)).isNull();
    }

    @Test
    void rejectsBlankOrNullToken() {
        assertThat(service().verifyAccessToken(null)).isNull();
        assertThat(service().verifyAccessToken("   ")).isNull();
    }
}
