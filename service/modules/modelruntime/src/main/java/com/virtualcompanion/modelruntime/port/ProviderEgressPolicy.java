package com.virtualcompanion.modelruntime.port;

import java.net.URI;
import java.util.HashSet;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Egress allowlist for provider endpoints (P2-05).
 *
 * <p>Only HTTPS to an approved host:port is reachable outside loopback. The
 * default allowlist is the approved supplier set {api.openai.com:443,
 * api.anthropic.com:443}; the loopback address {@code 127.0.0.1} stays
 * reachable over http(s) on any port so offline mock-server contract tests
 * keep working while no private network, link-local, metadata, broadcast or
 * multicast address can be targeted. Literal IPv6 endpoints are never
 * approved. The check is purely lexical (host string / literal IP category);
 * it never resolves DNS or opens a connection, and failure messages never
 * include credentials or configuration details.</p>
 *
 * <p>Providers may inject a custom approved host set (e.g. tests); production
 * wiring uses {@link #defaults()}.</p>
 */
public final class ProviderEgressPolicy {

    public static final String OPENAI_HOST = "api.openai.com";
    public static final String ANTHROPIC_HOST = "api.anthropic.com";
    public static final String LOOPBACK_HOST = "127.0.0.1";
    public static final int HTTPS_PORT = 443;

    private static final Set<String> DEFAULT_APPROVED_HOSTS =
            Set.of(OPENAI_HOST, ANTHROPIC_HOST);
    private static final Pattern IPV4_LITERAL = Pattern.compile(
            "^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    private final Set<String> approvedHosts;

    /** The default approved set plus operator-configured extra hosts. */
    public static ProviderEgressPolicy defaultsPlus(java.util.Collection<String> extraHosts) {
        var merged = new HashSet<>(DEFAULT_APPROVED_HOSTS);
        if (extraHosts != null) {
            for (String host : extraHosts) {
                merged.add(normalizeHostname(Objects.requireNonNull(
                        host, "approved host must not be null")));
            }
        }
        return new ProviderEgressPolicy(merged);
    }

    public ProviderEgressPolicy(Set<String> approvedHosts) {
        Objects.requireNonNull(approvedHosts, "approvedHosts must not be null");
        if (approvedHosts.isEmpty()) {
            throw new IllegalArgumentException("approvedHosts must not be empty");
        }
        var normalizedApprovedHosts = new HashSet<String>();
        for (String approvedHost : approvedHosts) {
            normalizedApprovedHosts.add(normalizeHostname(Objects.requireNonNull(
                    approvedHost, "approved host must not be null")));
        }
        if (normalizedApprovedHosts.contains(LOOPBACK_HOST)) {
            throw new IllegalArgumentException(
                    "loopback must not be part of the approved host set"
                            + " (loopback is handled explicitly by the policy)");
        }
        this.approvedHosts = Set.copyOf(normalizedApprovedHosts);
    }

    /** The production egress policy: approved suppliers + loopback only. */
    public static ProviderEgressPolicy defaults() {
        return new ProviderEgressPolicy(DEFAULT_APPROVED_HOSTS);
    }

    /**
     * Reject an endpoint that is not on the approved egress allowlist.
     *
     * @param endpoint the configured provider endpoint
     * @throws IllegalArgumentException when the endpoint is not approved
     */
    public void requireAllowed(URI endpoint) {
        Objects.requireNonNull(endpoint, "endpoint must not be null");
        String scheme = endpoint.getScheme();
        if (scheme == null || scheme.isBlank()) {
            throw new IllegalArgumentException("endpoint must include a scheme");
        }
        String host = endpoint.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("endpoint must include a host");
        }
        if (host.contains(":")) {
            throw new IllegalArgumentException(
                    "endpoint must not use an IPv6 literal host");
        }
        String normalizedHost = normalizeHostname(host);
        if (LOOPBACK_HOST.equals(normalizedHost)) {
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) {
                throw new IllegalArgumentException(
                        "endpoint must use https, or http on the loopback address");
            }
            return;
        }
        if (!"https".equalsIgnoreCase(scheme)) {
            throw new IllegalArgumentException(
                    "endpoint must use https outside the loopback address");
        }
        int port = endpoint.getPort();
        if (port != -1 && port != HTTPS_PORT) {
            throw new IllegalArgumentException(
                    "endpoint must use port 443 outside the loopback address");
        }
        String addressCategory = ipv4Category(normalizedHost);
        if (addressCategory != null) {
            throw new IllegalArgumentException(
                    "endpoint host is on a blocked address category: " + addressCategory);
        }
        if (!approvedHosts.contains(normalizedHost)) {
            throw new IllegalArgumentException(
                    "endpoint host is not on the approved provider egress allowlist");
        }
    }

    private static String normalizeHostname(String host) {
        return host.toLowerCase(Locale.ROOT);
    }

    /**
     * @return a category name when {@code host} is a literal IPv4 address in a
     *         blocked range (private, loopback, link-local, CGNAT/metadata,
     *         any-local, multicast, reserved or broadcast), else {@code null}
     */
    private static String ipv4Category(String host) {
        Matcher matcher = IPV4_LITERAL.matcher(host);
        if (!matcher.matches()) {
            return null;
        }
        int[] octets = new int[4];
        for (int index = 0; index < 4; index++) {
            octets[index] = Integer.parseInt(matcher.group(index + 1));
            if (octets[index] > 255) {
                return null;
            }
        }
        int first = octets[0];
        int second = octets[1];
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
}
