package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.AdmissionLease;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.Route;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitException;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.springframework.http.MediaType;
import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.ServletRequestPathUtils;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/** Source admission and global non-blocking bulkhead for exact login/refresh routes. */
public final class AuthSourceAdmissionFilter extends OncePerRequestFilter {

    static final String LOGIN_PATH = "/api/v1/auth/login";
    static final String REFRESH_PATH = "/api/v1/auth/refresh";
    private static final String INVALID_REQUEST_BODY =
            "{\"code\":\"INVALID_REQUEST\",\"message\":\"The request is invalid\"}";
    private static final PathPattern LOGIN_PATTERN =
            PathPatternParser.defaultInstance.parse(LOGIN_PATH);
    private static final PathPattern REFRESH_PATTERN =
            PathPatternParser.defaultInstance.parse(REFRESH_PATH);

    private final AuthAbuseGuard guard;

    public AuthSourceAdmissionFilter(AuthAbuseGuard guard) {
        this.guard = guard;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        RouteMatch match = route(request);
        if (match == null) {
            chain.doFilter(request, response);
            return;
        }
        if (!match.canonical()) {
            rejectNonCanonicalPath(response);
            return;
        }

        AdmissionLease lease;
        try {
            lease = guard.admitSource(match.route(), request.getRemoteAddr());
        } catch (AuthRateLimitException e) {
            AuthRateLimitResponse.write(response, e.retryAfterSeconds());
            return;
        } catch (RuntimeException e) {
            AuthRateLimitResponse.write(response, AuthAbuseGuard.CAPACITY_RETRY_SECONDS);
            return;
        }

        try (lease) {
            chain.doFilter(request, response);
        }
    }

    private static RouteMatch route(HttpServletRequest request) {
        if (!"POST".equals(request.getMethod())) {
            return null;
        }
        RequestPath requestPath = ServletRequestPathUtils.parse(request);
        PathContainer path = requestPath.pathWithinApplication();
        if (LOGIN_PATTERN.matches(path)) {
            return new RouteMatch(Route.LOGIN, LOGIN_PATH.equals(path.value()));
        }
        if (REFRESH_PATTERN.matches(path)) {
            return new RouteMatch(Route.REFRESH, REFRESH_PATH.equals(path.value()));
        }
        return null;
    }

    private static void rejectNonCanonicalPath(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(INVALID_REQUEST_BODY);
    }

    private record RouteMatch(Route route, boolean canonical) {}
}
