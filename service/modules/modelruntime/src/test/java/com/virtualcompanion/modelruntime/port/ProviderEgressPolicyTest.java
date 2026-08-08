package com.virtualcompanion.modelruntime.port;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.net.URI;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * P2-05 egress allowlist contract: approved suppliers over HTTPS and the
 * loopback address for offline mock-server tests are reachable; plain HTTP
 * outside loopback, unapproved hosts, private/link-local/metadata/CGNAT
 * addresses, non-443 ports and IPv6 literals fail closed.
 */
class ProviderEgressPolicyTest {

    private final ProviderEgressPolicy policy = ProviderEgressPolicy.defaults();

    @Test
    void approvedSupplierEndpointsAreAllowed() {
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("https://api.openai.com/v1/chat/completions")));
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("https://api.openai.com:443/v1/chat/completions")));
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("https://api.anthropic.com/v1/messages")));
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("https://api.anthropic.com:443/v1/messages")));
    }

    @Test
    void loopbackIsAllowedOverHttpAndHttpsOnAnyPort() {
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("http://127.0.0.1/v1/chat/completions")));
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("http://127.0.0.1:9/v1/messages")));
        assertDoesNotThrow(() -> policy.requireAllowed(
                URI.create("https://127.0.0.1:8443/v1/chat/completions")));
    }

    @Test
    void plainHttpOutsideLoopbackIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("http://api.openai.com/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("http://api.anthropic.com/v1/messages")));
    }

    @Test
    void unapprovedHostsAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://evil.example.com/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://api.openai.com.evil.example/v1/chat/completions")));
    }

    @Test
    void publicIpLiteralsAreNotApproved() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://8.8.8.8/v1/chat/completions")));
    }

    @Test
    void privateNetworkAddressesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://10.0.0.1/v1/messages")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://172.16.0.1/v1/messages")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://172.31.255.254/v1/messages")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://192.168.1.5/v1/chat/completions")));
    }

    @Test
    void loopbackRangeOutsideApprovedAddressIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://127.0.0.2/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("http://127.1.2.3/v1/messages")));
    }

    @Test
    void linkLocalAndMetadataAddressesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://169.254.169.254/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://169.254.0.1/v1/messages")));
    }

    @Test
    void cgnatAndCloudMetadataAddressesAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://100.100.100.200/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://100.64.0.1/v1/messages")));
    }

    @Test
    void anyLocalMulticastReservedAndBroadcastAreRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://0.0.0.0/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://224.0.0.1/v1/messages")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://240.0.0.1/v1/messages")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://255.255.255.255/v1/messages")));
    }

    @Test
    void nonStandardPortOutsideLoopbackIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://api.openai.com:8443/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://api.anthropic.com:8080/v1/messages")));
    }

    @Test
    void ipv6LiteralsAreNeverApproved() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://[::1]/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://[fe80::1]/v1/messages")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https://[::ffff:127.0.0.1]/v1/chat/completions")));
    }

    @Test
    void missingHostOrSchemeIsRejected() {
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("https:///v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> policy.requireAllowed(
                URI.create("api.openai.com/v1/chat/completions")));
        assertThrows(NullPointerException.class, () -> policy.requireAllowed(null));
    }

    @Test
    void customApprovedHostSetIsRespected() {
        ProviderEgressPolicy custom =
                new ProviderEgressPolicy(Set.of("my-gateway.example.com"));

        assertDoesNotThrow(() -> custom.requireAllowed(
                URI.create("https://my-gateway.example.com/v1/chat/completions")));
        assertThrows(IllegalArgumentException.class, () -> custom.requireAllowed(
                URI.create("https://api.openai.com/v1/chat/completions")));
    }

    @Test
    void invalidPolicyConfigurationFailsClosed() {
        assertThrows(IllegalArgumentException.class,
                () -> new ProviderEgressPolicy(Set.of()));
        assertThrows(IllegalArgumentException.class,
                () -> new ProviderEgressPolicy(Set.of("127.0.0.1")));
        assertThrows(NullPointerException.class,
                () -> new ProviderEgressPolicy(null));
    }
}
