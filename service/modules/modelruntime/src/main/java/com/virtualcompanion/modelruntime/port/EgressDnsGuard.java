package com.virtualcompanion.modelruntime.port;

import java.io.IOException;
import java.net.Inet4Address;
import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;
import java.util.Objects;

/**
 * Connection-layer egress guard: DNS rebinding defense in depth (P3 boundary
 * recorded by TASK-0108).
 *
 * <p>{@link ProviderEgressPolicy} approves host strings lexically without
 * resolving DNS, so an approved hostname rebound or poisoned to an internal
 * address would still steer the TCP connection before TLS rejects it. This
 * guard validates the actual resolution result before a connection is opened:
 * every address resolved for a non-loopback host must be on a public category;
 * private, loopback, link-local, metadata/CGNAT, multicast and reserved ranges
 * fail closed. The literal loopback address {@code 127.0.0.1} stays reachable
 * without resolving so offline mock-server contract tests keep working. The
 * check is injected before {@code sendAsync} and failure messages never
 * include host, address or credential details.</p>
 *
 * <p>The class is non-final so contract tests can inject a deterministic
 * guard (e.g. one that always rejects) through the Session constructor; the
 * {@link #defaults()} factory remains the only production instance.</p>
 */
public class EgressDnsGuard {

    /** The literal loopback host allowed without DNS resolution. */
    public static final String LOOPBACK_HOST = "127.0.0.1";

    /** The strict production guard. */
    public static EgressDnsGuard defaults() {
        return new EgressDnsGuard();
    }

    /**
     * Validate the actual DNS resolution of {@code endpoint}'s host before a
     * connection is opened. The literal loopback address {@code 127.0.0.1} is
     * allowed without resolving. Any other host must resolve to at least one
     * address and every resolved address must be on a public category.
     *
     * @param endpoint the configured provider endpoint
     * @throws IOException         when the host cannot be resolved
     * @throws IllegalArgumentException when the endpoint has no host or the
     *         resolution is empty or blocked
     */
    public void requireAllowedResolution(URI endpoint) throws IOException {
        Objects.requireNonNull(endpoint, "endpoint must not be null");
        String host = endpoint.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException(
                    "endpoint must include a host");
        }
        if (LOOPBACK_HOST.equals(host)) {
            return;
        }
        InetAddress[] resolved;
        try {
            resolved = InetAddress.getAllByName(host);
        } catch (UnknownHostException exception) {
            throw new IOException("endpoint host cannot be resolved", exception);
        }
        requireAllowedResolution(host, resolved);
    }

    /**
     * Pure validation of a resolved address set (injectable for tests; this
     * overload never resolves DNS itself). The literal loopback address
     * {@code 127.0.0.1} is allowed without inspection; any other host must
     * resolve to at least one address and every address must be on a public
     * category.
     *
     * @param host     the endpoint host string
     * @param resolved the addresses the host resolved to
     * @throws IllegalArgumentException when the resolution is empty or any
     *         address is on a blocked category
     */
    public void requireAllowedResolution(String host, InetAddress[] resolved) {
        Objects.requireNonNull(host, "host must not be null");
        Objects.requireNonNull(resolved, "resolved must not be null");
        if (LOOPBACK_HOST.equals(host)) {
            return;
        }
        if (resolved.length == 0) {
            throw new IllegalArgumentException(
                    "endpoint host resolution must not be empty");
        }
        for (InetAddress address : resolved) {
            if (blockedCategory(address) != null) {
                throw new IllegalArgumentException(
                        "endpoint host resolved to a blocked address category");
            }
        }
    }

    /**
     * @return a category name when {@code address} is on a blocked range
     *         (private, loopback, link-local, CGNAT/metadata, any-local,
     *         multicast, reserved or broadcast), else {@code null}
     */
    private static String blockedCategory(InetAddress address) {
        if (address instanceof Inet4Address v4) {
            return blockedIpv4(v4.getAddress());
        }
        if (address instanceof Inet6Address v6) {
            return blockedIpv6(v6.getAddress());
        }
        return "unknown address family";
    }

    private static String blockedIpv4(byte[] bytes) {
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        if (first == 0) {
            return "any-local (0.0.0.0/8)";
        }
        if (first == 10) {
            return "private network (10.0.0.0/8)";
        }
        if (first == 100 && second >= 64 && second <= 127) {
            return "shared/CGNAT (100.64.0.0/10, incl. metadata 100.100.100.200)";
        }
        if (first == 127) {
            return "loopback (127.0.0.0/8)";
        }
        if (first == 169 && second == 254) {
            return "link-local (169.254.0.0/16, incl. metadata 169.254.169.254)";
        }
        if (first == 172 && second >= 16 && second <= 31) {
            return "private network (172.16.0.0/12)";
        }
        if (first == 192 && second == 168) {
            return "private network (192.168.0.0/16)";
        }
        if (first >= 224) {
            return "multicast/reserved/broadcast (224.0.0.0/4+)";
        }
        return null;
    }

    private static String blockedIpv6(byte[] bytes) {
        if (isAllZero(bytes, 0, 15) && (bytes[15] & 0xff) == 1) {
            return "loopback (::1)";
        }
        if ((bytes[0] & 0xff) == 0xfe && (bytes[1] & 0xc0) == 0x80) {
            return "link-local (fe80::/10)";
        }
        if ((bytes[0] & 0xfe) == 0xfc) {
            return "unique local (fc00::/7)";
        }
        if (isAllZero(bytes, 0, 16)) {
            return "unspecified (::)";
        }
        if ((bytes[0] & 0xff) == 0xff) {
            return "multicast (ff00::/8)";
        }
        if ((bytes[0] & 0xff) == 0x00
                && (bytes[1] & 0xff) == 0x64
                && (bytes[2] & 0xff) == 0xff
                && (bytes[3] & 0xff) == 0x9b
                && isAllZero(bytes, 4, 12)) {
            // 64:ff9b::/96 well-known NAT64 prefix: an IPv6-only network can
            // route these to arbitrary internal IPv4 addresses.
            byte[] mapped = {bytes[12], bytes[13], bytes[14], bytes[15]};
            String category = blockedIpv4(mapped);
            return category != null ? "NAT64 " + category : null;
        }
        if (isAllZero(bytes, 0, 10)
                && (bytes[10] & 0xff) == 0xff
                && (bytes[11] & 0xff) == 0xff) {
            byte[] mapped = {bytes[12], bytes[13], bytes[14], bytes[15]};
            String category = blockedIpv4(mapped);
            return category != null ? "IPv4-mapped " + category : null;
        }
        return null;
    }

    private static boolean isAllZero(byte[] bytes, int from, int toExclusive) {
        for (int index = from; index < toExclusive; index++) {
            if (bytes[index] != 0) {
                return false;
            }
        }
        return true;
    }
}
