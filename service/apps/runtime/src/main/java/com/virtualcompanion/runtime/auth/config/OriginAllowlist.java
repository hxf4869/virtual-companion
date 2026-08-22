package com.virtualcompanion.runtime.auth.config;

import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

/**
 * S0-06: exact Origin allow-list for H5/API. The frozen deploy model is
 * same-origin reverse proxy (Caddy serves the H5 shell and {@code /api/*}
 * from one host). Cross-site and wildcard origins are not a supported
 * deployment; an allow-list entry of {@code *}, {@code null}, a scheme-less
 * host, a wildcard host, or a path/query/fragment fails closed at parse time
 * rather than being stored as a CORS origin.
 *
 * <p>Empty input stays empty: non-browser clients that omit {@code Origin}
 * are unaffected. A present {@code Origin} header must match an exact
 * http(s) origin after canonicalization.
 */
public final class OriginAllowlist {

    private OriginAllowlist() {}

    /**
     * Parse configured origins. Blank entries (empty env expansion) are
     * skipped; any wildcard or non-origin value fails closed.
     */
    public static List<String> parse(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> origins = new LinkedHashSet<>();
        for (String item : raw) {
            if (item == null) {
                continue;
            }
            String trimmed = item.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            origins.add(canonicalize(trimmed));
        }
        return List.copyOf(origins);
    }

    /**
     * True when the request has no Origin (non-browser / same-origin curl)
     * or when the Origin canonicalizes to an allow-list entry. Malformed or
     * wildcard request Origins never match.
     */
    public static boolean allows(List<String> allowlist, String requestOrigin) {
        Objects.requireNonNull(allowlist, "allowlist");
        if (requestOrigin == null) {
            return true;
        }
        String trimmed = requestOrigin.trim();
        if (trimmed.isEmpty()) {
            return false;
        }
        try {
            return allowlist.contains(canonicalize(trimmed));
        } catch (IllegalStateException ignored) {
            return false;
        }
    }

    static String canonicalize(String origin) {
        if (origin.indexOf('*') >= 0 || "null".equalsIgnoreCase(origin)) {
            throw new IllegalStateException(
                    "cors allowed origin must be an exact origin, not a wildcard: "
                            + origin);
        }
        URI uri;
        try {
            uri = URI.create(origin);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "cors allowed origin is not a URI: " + origin, e);
        }
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null || host == null || host.isBlank()) {
            throw new IllegalStateException(
                    "cors allowed origin must be an exact http(s) origin: " + origin);
        }
        String lowerScheme = scheme.toLowerCase(Locale.ROOT);
        if (!lowerScheme.equals("https") && !lowerScheme.equals("http")) {
            throw new IllegalStateException(
                    "cors allowed origin scheme must be http or https: " + origin);
        }
        if (host.indexOf('*') >= 0) {
            throw new IllegalStateException(
                    "cors allowed origin host must be exact, not a wildcard: " + origin);
        }
        if (uri.getUserInfo() != null
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null) {
            throw new IllegalStateException(
                    "cors allowed origin must not include userinfo, query, or fragment: "
                            + origin);
        }
        String path = uri.getRawPath();
        if (path != null && !path.isEmpty() && !"/".equals(path)) {
            throw new IllegalStateException(
                    "cors allowed origin must not include a path: " + origin);
        }
        String canonical = lowerScheme + "://" + host.toLowerCase(Locale.ROOT);
        if (uri.getPort() != -1) {
            canonical += ":" + uri.getPort();
        }
        return canonical;
    }

    /** Methods the same-origin H5 actually uses, including PUT consents. */
    public static List<String> allowedMethods() {
        return List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
    }

    /** CORS credentials stay false: cookies travel same-origin, not via ACAO. */
    public static boolean allowCredentials() {
        return false;
    }
}
