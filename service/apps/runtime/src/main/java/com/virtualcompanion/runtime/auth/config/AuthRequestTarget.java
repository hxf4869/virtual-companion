package com.virtualcompanion.runtime.auth.config;

import io.micrometer.observation.ObservationRegistry;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;
import org.springframework.security.web.firewall.HttpStatusRequestRejectedHandler;
import org.springframework.security.web.firewall.ObservationMarkingRequestRejectedHandler;
import org.springframework.security.web.firewall.RequestRejectedException;
import org.springframework.security.web.firewall.RequestRejectedHandler;
import org.springframework.stereotype.Component;
import org.springframework.web.util.ServletRequestPathUtils;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/** Shared parsed/canonical boundary for the mapped Auth POST routes. */
final class AuthRequestTarget {

    private static final String AUTH_ROOT = "/api/v1/auth";
    private static final String INVALID_REQUEST_BODY =
            "{\"code\":\"INVALID_REQUEST\",\"message\":\"The request is invalid\"}";

    private AuthRequestTarget() {
    }

    static Match resolve(HttpServletRequest request) {
        if (request == null || !"POST".equals(request.getMethod())) {
            return Match.notTarget();
        }

        RequestPath requestPath;
        try {
            requestPath = ServletRequestPathUtils.parse(request);
        } catch (IllegalArgumentException e) {
            return isRawAuthTarget(request) ? Match.malformed() : Match.notTarget();
        }

        PathContainer path = requestPath.pathWithinApplication();
        return Arrays.stream(Route.values())
                .filter(route -> route.pattern.matches(path))
                .findFirst()
                .map(route -> route.path.equals(path.value())
                        ? Match.canonical(route)
                        : Match.nonCanonical(route))
                .orElseGet(Match::notTarget);
    }

    static boolean isRawAuthTarget(HttpServletRequest request) {
        if (request == null || !"POST".equals(request.getMethod())) {
            return false;
        }
        String path = request.getRequestURI();
        if (path == null) {
            return false;
        }
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isEmpty()) {
            if (!path.startsWith(contextPath)) {
                return false;
            }
            path = path.substring(contextPath.length());
        }
        return AUTH_ROOT.equals(path) || path.startsWith(AUTH_ROOT + "/");
    }

    static void reject(HttpServletResponse response) throws IOException {
        response.setStatus(HttpServletResponse.SC_BAD_REQUEST);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(INVALID_REQUEST_BODY);
    }

    enum Route {
        LOGIN("/api/v1/auth/login", true, true),
        REFRESH("/api/v1/auth/refresh", true, false),
        LOGOUT("/api/v1/auth/logout", false, false),
        ADMIN_ACCOUNTS("/api/v1/auth/admin/accounts", false, true);

        private final String path;
        private final boolean sourceAdmission;
        private final boolean bodyLimited;
        private final PathPattern pattern;

        Route(String path, boolean sourceAdmission, boolean bodyLimited) {
            this.path = path;
            this.sourceAdmission = sourceAdmission;
            this.bodyLimited = bodyLimited;
            this.pattern = PathPatternParser.defaultInstance.parse(path);
        }

        boolean sourceAdmission() {
            return sourceAdmission;
        }

        boolean bodyLimited() {
            return bodyLimited;
        }

        String path() {
            return path;
        }
    }

    enum Status {
        NOT_TARGET,
        CANONICAL,
        NON_CANONICAL,
        MALFORMED
    }

    record Match(Status status, Route route) {

        private static Match notTarget() {
            return new Match(Status.NOT_TARGET, null);
        }

        private static Match canonical(Route route) {
            return new Match(Status.CANONICAL, route);
        }

        private static Match nonCanonical(Route route) {
            return new Match(Status.NON_CANONICAL, route);
        }

        private static Match malformed() {
            return new Match(Status.MALFORMED, null);
        }

        boolean rejected() {
            return status == Status.NON_CANONICAL || status == Status.MALFORMED;
        }

        boolean canonical() {
            return status == Status.CANONICAL;
        }
    }
}

/** Preserves the fixed Auth envelope when Spring Security's firewall rejects first. */
@Component
@ConditionalOnProperty(name = "virtual-companion.auth.enabled", havingValue = "true")
final class AuthRequestRejectedHandler implements RequestRejectedHandler {

    private final RequestRejectedHandler observationMarker;
    private final RequestRejectedHandler fallback = new HttpStatusRequestRejectedHandler();

    AuthRequestRejectedHandler(ObservationRegistry observationRegistry) {
        this.observationMarker = new ObservationMarkingRequestRejectedHandler(observationRegistry);
    }

    @Override
    public void handle(
            HttpServletRequest request,
            HttpServletResponse response,
            RequestRejectedException exception) throws IOException, ServletException {
        observationMarker.handle(request, response, exception);
        AuthRequestTarget.Match match = AuthRequestTarget.resolve(request);
        if (match.rejected() || AuthRequestTarget.isRawAuthTarget(request)) {
            AuthRequestTarget.reject(response);
            return;
        }
        fallback.handle(request, response, exception);
    }
}
