package com.virtualcompanion.runtime.observability;

import java.net.URI;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * S0-31-A lexical allowlist for the configured alert webhook URL. HTTPS to a
 * public hostname is allowed; loopback {@code 127.0.0.1} stays reachable over
 * http(s) for offline tests. Private, link-local, metadata, userinfo and IPv6
 * literal endpoints fail closed. When {@code webhook-allowed-hosts} is set,
 * the host must also be on that list (loopback still uses the explicit
 * 127.0.0.1 rule, not DNS).
 */
public final class WebhookEgressPolicy {

    public static final String LOOPBACK_HOST = "127.0.0.1";

    private static final Pattern IPV4_LITERAL = Pattern.compile(
            "^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    private final Set<String> allowedHosts;

    public static WebhookEgressPolicy parse(String allowedHosts) {
        Set<String> hosts = new HashSet<>();
        if (allowedHosts != null && !allowedHosts.isBlank()) {
            for (String part : allowedHosts.split(",")) {
                String host = part.trim().toLowerCase(Locale.ROOT);
                if (!host.isEmpty()) {
                    hosts.add(host);
                }
            }
        }
        return new WebhookEgressPolicy(hosts);
    }

    WebhookEgressPolicy(Set<String> allowedHosts) {
        this.allowedHosts = Set.copyOf(allowedHosts);
    }

    public void requireAllowed(URI endpoint) {
        if (endpoint == null) {
            throw new IllegalArgumentException("endpoint must not be null");
        }
        String scheme = endpoint.getScheme();
        if (scheme == null || scheme.isBlank()) {
            throw new IllegalArgumentException("endpoint must include a scheme");
        }
        if (endpoint.getUserInfo() != null) {
            throw new IllegalArgumentException("endpoint must not include userinfo");
        }
        String host = endpoint.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("endpoint must include a host");
        }
        if (host.contains(":")) {
            throw new IllegalArgumentException("endpoint must not use an IPv6 literal host");
        }
        String normalizedHost = host.toLowerCase(Locale.ROOT);
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
        String addressCategory = ipv4Category(normalizedHost);
        if (addressCategory != null) {
            throw new IllegalArgumentException(
                    "endpoint host is on a blocked address category");
        }
        if (!allowedHosts.isEmpty() && !allowedHosts.contains(normalizedHost)) {
            throw new IllegalArgumentException(
                    "endpoint host is not on the webhook allowlist");
        }
    }

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
            return "any-local";
        }
        if (first == 10) {
            return "private";
        }
        if (first == 100 && second >= 64 && second <= 127) {
            return "cgnat";
        }
        if (first == 127) {
            return "loopback";
        }
        if (first == 169 && second == 254) {
            return "link-local";
        }
        if (first == 172 && second >= 16 && second <= 31) {
            return "private";
        }
        if (first == 192 && second == 168) {
            return "private";
        }
        if (first >= 224) {
            return "multicast";
        }
        return null;
    }
}
