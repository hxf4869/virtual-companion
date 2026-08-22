package com.virtualcompanion.runtime.observability;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.net.URI;
import org.junit.jupiter.api.Test;

class WebhookEgressPolicyTest {

    private final WebhookEgressPolicy open = WebhookEgressPolicy.parse("");
    private final WebhookEgressPolicy listed = WebhookEgressPolicy.parse("hooks.example.com");

    @Test
    void loopbackHttpIsAllowed() {
        assertDoesNotThrow(() -> open.requireAllowed(URI.create("http://127.0.0.1:9/hook")));
    }

    @Test
    void httpsPublicHostIsAllowedWhenAllowlistEmpty() {
        assertDoesNotThrow(() -> open.requireAllowed(URI.create("https://hooks.example.com/a")));
    }

    @Test
    void allowlistRejectsOtherHosts() {
        assertThrows(IllegalArgumentException.class,
                () -> listed.requireAllowed(URI.create("https://evil.example/x")));
        assertDoesNotThrow(() -> listed.requireAllowed(URI.create("https://hooks.example.com/x")));
    }

    @Test
    void metadataAndPrivateLiteralsAreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("https://169.254.169.254/latest")));
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("http://192.168.1.8/hook")));
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("https://10.0.0.4/hook")));
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("https://100.100.100.200/hook")));
    }

    @Test
    void userinfoAndIpv6AreRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("https://user:pass@hooks.example.com/x")));
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("https://[::1]/x")));
    }

    @Test
    void httpOutsideLoopbackIsRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> open.requireAllowed(URI.create("http://hooks.example.com/x")));
    }
}
