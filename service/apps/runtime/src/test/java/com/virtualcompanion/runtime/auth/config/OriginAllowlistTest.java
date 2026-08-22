package com.virtualcompanion.runtime.auth.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * S0-06: the shipped Origin allow-list parser is the gate. Wildcards, the
 * opaque {@code null} origin, paths and non-http schemes must fail closed;
 * exact http(s) origins canonicalize and match case-insensitively on host.
 */
class OriginAllowlistTest {

    @Test
    void emptyAndBlankEntriesStayEmpty() {
        assertEquals(List.of(), OriginAllowlist.parse(null));
        assertEquals(List.of(), OriginAllowlist.parse(List.of()));
        assertEquals(List.of(), OriginAllowlist.parse(List.of("", "  ")));
    }

    @Test
    void exactHttpsOriginIsKeptCanonical() {
        assertEquals(
                List.of("https://app.example"),
                OriginAllowlist.parse(List.of("https://APP.example")));
    }

    @Test
    void localViteOriginMayUseHttpAndPort() {
        assertEquals(
                List.of("http://127.0.0.1:5173"),
                OriginAllowlist.parse(List.of("http://127.0.0.1:5173")));
    }

    @Test
    void wildcardStarFailsClosed() {
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("*")));
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("https://*")));
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("https://*.example.com")));
    }

    @Test
    void opaqueNullOriginFailsClosed() {
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("null")));
    }

    @Test
    void pathQueryFragmentAndUserinfoFailClosed() {
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("https://app.example/h5")));
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("https://app.example/?x=1")));
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("https://user@app.example")));
    }

    @Test
    void nonHttpSchemeFailsClosed() {
        assertThrows(IllegalStateException.class,
                () -> OriginAllowlist.parse(List.of("ftp://app.example")));
    }

    @Test
    void allowsSkipsMissingOriginAndRejectsUnknownOrWildcardRequest() {
        List<String> allow = OriginAllowlist.parse(List.of("https://app.example"));
        assertTrue(OriginAllowlist.allows(allow, null));
        assertTrue(OriginAllowlist.allows(allow, "https://APP.example"));
        assertFalse(OriginAllowlist.allows(allow, "https://evil.example"));
        assertFalse(OriginAllowlist.allows(allow, "*"));
        assertFalse(OriginAllowlist.allows(List.of(), "https://app.example"));
    }

    @Test
    void corsSurfaceKeepsPutAndDisablesCredentials() {
        assertTrue(OriginAllowlist.allowedMethods().contains("PUT"));
        assertFalse(OriginAllowlist.allowCredentials());
    }
}
