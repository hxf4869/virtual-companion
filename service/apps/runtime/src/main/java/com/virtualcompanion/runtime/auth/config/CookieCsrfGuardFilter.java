package com.virtualcompanion.runtime.auth.config;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * CSRF + Origin guard for the HttpOnly refresh-cookie session (P1-09, Owner
 * decision 2026-08-08: HttpOnly cookie + CSRF/Origin).
 *
 * <p>Rules (state-changing methods only -- GET/HEAD/OPTIONS pass through):
 * <ul>
 *   <li>Any request carrying an {@code Origin} header must hit the configured
 *       Alpha allow-list ({@code virtual-companion.auth.cors-allowed-origins});
 *       an unknown Origin is rejected with 403 before anything else.</li>
 *   <li>Requests that carry the session cookies ({@code vc_refresh} or
 *       {@code vc_csrf}) must present an {@code X-CSRF-Token} header equal to
 *       the {@code vc_csrf} double-submit cookie value (constant-time
 *       comparison), otherwise 403.</li>
 *   <li>Bearer-only requests without session cookies are not CSRF-bound --
 *       there is no cookie session to abuse; the Origin check still applies.
 *   </li>
 * </ul>
 *
 * <p>The filter runs before the JWT authentication filter and before routing;
 * it never discloses whether a resource exists and never changes the 401
 * AUTHENTICATION_REQUIRED semantics of the authentication entry point.
 */
public class CookieCsrfGuardFilter extends OncePerRequestFilter {

    public static final String REFRESH_COOKIE = "vc_refresh";
    public static final String CSRF_COOKIE = "vc_csrf";
    public static final String CSRF_HEADER = "X-CSRF-Token";
    public static final String REJECTED_CODE = "CSRF_REJECTED";

    private final List<String> allowedOrigins;

    public CookieCsrfGuardFilter(List<String> allowedOrigins) {
        this.allowedOrigins = OriginAllowlist.parse(allowedOrigins);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        if (!isStateChanging(request.getMethod())) {
            chain.doFilter(request, response);
            return;
        }
        String origin = request.getHeader("Origin");
        if (!OriginAllowlist.allows(allowedOrigins, origin)) {
            reject(response, "Origin is not allowed");
            return;
        }
        if (hasSessionCookie(request)) {
            String csrfCookie = cookieValue(request, CSRF_COOKIE);
            String csrfHeader = request.getHeader(CSRF_HEADER);
            if (csrfCookie == null || csrfHeader == null
                    || !constantTimeEquals(csrfCookie, csrfHeader)) {
                reject(response, "A valid X-CSRF-Token header is required");
                return;
            }
        }
        chain.doFilter(request, response);
    }

    private static boolean isStateChanging(String method) {
        String m = method == null ? "" : method.toUpperCase(Locale.ROOT);
        return m.equals("POST") || m.equals("PUT") || m.equals("PATCH") || m.equals("DELETE");
    }

    private static boolean hasSessionCookie(HttpServletRequest request) {
        return cookieValue(request, REFRESH_COOKIE) != null || cookieValue(request, CSRF_COOKIE) != null;
    }

    private static String cookieValue(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(
                left.getBytes(StandardCharsets.UTF_8),
                right.getBytes(StandardCharsets.UTF_8));
    }

    private static void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpStatus.FORBIDDEN.value());
        response.setCharacterEncoding("UTF-8");
        response.setContentType("application/json");
        response.getWriter().write(
                "{\"code\":\"" + REJECTED_CODE + "\",\"message\":\"" + message + "\"}");
    }
}
