package com.virtualcompanion.runtime.auth.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AuthInputLimitsTest {

    @Test
    void countsUtf8BytesRatherThanJavaCharacters() {
        assertThat(AuthInputLimits.utf8ByteLength("a")).isEqualTo(1);
        assertThat(AuthInputLimits.utf8ByteLength("é")).isEqualTo(2);
        assertThat(AuthInputLimits.utf8ByteLength("界")).isEqualTo(3);
        assertThat(AuthInputLimits.utf8ByteLength("😀")).isEqualTo(4);
        assertThat(AuthInputLimits.utf8ByteLength("�")).isEqualTo(3);
    }

    @Test
    void frozenFieldLimitsAcceptExactAndRejectOneOver() {
        int[] limits = {
            AuthInputLimits.MAX_USERNAME_UTF8_BYTES,
            AuthInputLimits.MAX_PASSWORD_UTF8_BYTES,
            AuthInputLimits.MAX_DISPLAY_NAME_UTF8_BYTES,
            AuthInputLimits.MAX_ROLE_UTF8_BYTES,
            AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES
        };

        for (int limit : limits) {
            String exact = "😀".repeat(limit / 4);
            String oneOver = exact + "a";

            assertThat(AuthInputLimits.utf8ByteLength(exact)).isEqualTo(limit);
            assertThat(AuthInputLimits.withinUtf8Bytes(exact, limit)).isTrue();
            assertThat(AuthInputLimits.utf8ByteLength(oneOver)).isEqualTo(limit + 1);
            assertThat(AuthInputLimits.withinUtf8Bytes(oneOver, limit)).isFalse();
        }
    }

    @Test
    void exactAndOneOverBoundariesWorkForOneThreeAndFourByteCodePoints() {
        assertBoundary("a".repeat(64), 64);
        assertBoundary("界".repeat(21) + "a", 64);
        assertBoundary("😀".repeat(16), 64);
    }

    @Test
    void nullIsHandledByRequiredOrOptionalFieldValidation() {
        assertThat(AuthInputLimits.utf8ByteLength(null)).isZero();
        assertThat(AuthInputLimits.withinUtf8Bytes(null, 0)).isTrue();
    }

    @Test
    void loneSurrogatesFailClosedWithoutReplacementAliases() {
        for (String malformed : new String[] {"\uD800", "\uDC00"}) {
            assertThat(AuthInputLimits.withinUtf8Bytes(malformed, 64)).isFalse();
            assertThatThrownBy(() -> AuthInputLimits.utf8ByteLength(malformed))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessage("value is not valid UTF-8")
                    .hasMessageNotContaining(malformed);
        }
        assertThat(AuthInputLimits.withinUtf8Bytes("�", 3)).isTrue();
    }

    @Test
    void negativeMaximumRemainsAProgrammingError() {
        assertThatThrownBy(() -> AuthInputLimits.withinUtf8Bytes("value", -1))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("maximumBytes must not be negative");
    }

    private static void assertBoundary(String exact, int maximumBytes) {
        assertThat(AuthInputLimits.utf8ByteLength(exact)).isEqualTo(maximumBytes);
        assertThat(AuthInputLimits.withinUtf8Bytes(exact, maximumBytes)).isTrue();
        assertThat(AuthInputLimits.withinUtf8Bytes(exact + "a", maximumBytes)).isFalse();
    }
}
