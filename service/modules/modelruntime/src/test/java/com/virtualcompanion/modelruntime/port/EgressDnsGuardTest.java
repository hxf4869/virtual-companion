package com.virtualcompanion.modelruntime.port;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import org.junit.jupiter.api.Test;

/**
 * Connection-layer DNS resolution guard contract: every resolved address for a
 * non-loopback host must be on a public category; private, loopback,
 * link-local, metadata/CGNAT, multicast and reserved ranges fail closed, empty
 * resolutions fail closed, the literal loopback address stays allowed without
 * resolving, and failure messages never leak host or address details.
 */
class EgressDnsGuardTest {

    private final EgressDnsGuard guard = EgressDnsGuard.defaults();

    private static InetAddress[] addresses(String... literals) {
        InetAddress[] result = new InetAddress[literals.length];
        for (int index = 0; index < literals.length; index++) {
            try {
                result[index] = InetAddress.getByName(literals[index]);
            } catch (UnknownHostException exception) {
                throw new AssertionError("invalid test literal " + literals[index], exception);
            }
        }
        return result;
    }

    @Test
    void publicIpv4AddressesAreAllowed() {
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                "api.openai.com", addresses("8.8.8.8", "1.1.1.1")));
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                "api.anthropic.com", addresses("104.18.0.1", "93.184.216.34")));
    }

    @Test
    void publicIpv6AddressesAreAllowed() {
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                "api.openai.com", addresses("2001:4860:4860::8888")));
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                "api.anthropic.com", addresses("2606:4700:4700::1111")));
    }

    @Test
    void privateIpv4CategoriesAreBlocked() {
        assertBlocked("api.openai.com", "0.0.0.1");          // any-local 0/8
        assertBlocked("api.openai.com", "10.1.2.3");         // private 10/8
        assertBlocked("api.openai.com", "100.64.0.1");       // shared/CGNAT
        assertBlocked("api.openai.com", "100.100.100.200");  // metadata (CGNAT)
        assertBlocked("api.openai.com", "127.0.0.1");        // loopback
        assertBlocked("api.openai.com", "127.0.0.2");        // loopback 127/8
        assertBlocked("api.openai.com", "169.254.169.254");  // metadata link-local
        assertBlocked("api.openai.com", "169.254.1.1");      // link-local
        assertBlocked("api.openai.com", "172.16.0.1");       // private 172.16/12
        assertBlocked("api.openai.com", "172.31.255.254");   // private 172.16/12 end
        assertBlocked("api.openai.com", "192.168.1.5");      // private 192.168/16
        assertBlocked("api.openai.com", "224.0.0.1");        // multicast
        assertBlocked("api.openai.com", "255.255.255.255");  // broadcast/reserved
    }

    @Test
    void blockedIpv6CategoriesAreBlocked() {
        assertBlocked("api.openai.com", "::1");              // loopback
        assertBlocked("api.openai.com", "fe80::1");          // link-local
        assertBlocked("api.openai.com", "fc00::1");          // unique local
        assertBlocked("api.openai.com", "fd12:3456::1");     // unique local fd00::/8
        assertBlocked("api.openai.com", "::");               // unspecified
        assertBlocked("api.openai.com", "::ffff:10.0.0.1");  // IPv4-mapped private
        assertBlocked("api.openai.com", "::ffff:127.0.0.1"); // IPv4-mapped loopback
        assertBlocked("api.openai.com", "::ffff:169.254.169.254"); // mapped metadata
        assertBlocked("api.openai.com", "::ffff:192.168.0.1");     // mapped private
    }

    @Test
    void anyBlockedAddressAmongPublicOnesFailsClosed() {
        assertThrows(IllegalArgumentException.class, () -> guard.requireAllowedResolution(
                "api.openai.com",
                addresses("8.8.8.8", "10.0.0.1", "1.1.1.1")));
    }

    @Test
    void emptyResolutionFailsClosed() {
        assertThrows(IllegalArgumentException.class, () -> guard.requireAllowedResolution(
                "api.openai.com", new InetAddress[0]));
    }

    @Test
    void literalLoopbackHostIsAllowedWithoutInspection() {
        // Even an empty or private "resolution" is never consulted for the
        // literal loopback address, preserving offline mock-server tests.
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                "127.0.0.1", new InetAddress[0]));
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                "127.0.0.1", addresses("10.0.0.1")));
    }

    @Test
    void nullArgumentsFailClosed() {
        assertThrows(NullPointerException.class, () -> guard.requireAllowedResolution(
                (String) null, addresses("8.8.8.8")));
        assertThrows(NullPointerException.class, () -> guard.requireAllowedResolution(
                "api.openai.com", null));
        assertThrows(NullPointerException.class, () -> guard.requireAllowedResolution(
                (URI) null));
    }

    @Test
    void endpointWithoutHostFailsClosed() {
        assertThrows(IllegalArgumentException.class, () -> guard.requireAllowedResolution(
                URI.create("https:///path")));
    }

    @Test
    void loopbackEndpointUriIsAllowedWithoutResolving() throws IOException {
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                URI.create("http://127.0.0.1:9/v1/messages")));
        assertDoesNotThrow(() -> guard.requireAllowedResolution(
                URI.create("https://127.0.0.1:8443/v1/chat/completions")));
    }

    @Test
    void failureMessageDoesNotLeakHostOrAddressDetails() {
        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                () -> guard.requireAllowedResolution(
                        "api.openai.com", addresses("192.168.1.5")));
        assertEquals("endpoint host resolved to a blocked address category",
                exception.getMessage());
        IllegalArgumentException empty = assertThrows(
                IllegalArgumentException.class,
                () -> guard.requireAllowedResolution("api.openai.com", new InetAddress[0]));
        assertEquals("endpoint host resolution must not be empty", empty.getMessage());
    }

    private void assertBlocked(String host, String literal) {
        assertThrows(IllegalArgumentException.class, () -> guard.requireAllowedResolution(
                host, addresses(literal)));
    }
}
