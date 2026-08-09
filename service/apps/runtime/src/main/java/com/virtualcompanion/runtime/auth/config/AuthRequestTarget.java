package com.virtualcompanion.runtime.auth.config;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.springframework.http.MediaType;
import org.springframework.http.server.PathContainer;
import org.springframework.http.server.RequestPath;
import org.springframework.web.util.ServletRequestPathUtils;
import org.springframework.web.util.pattern.PathPattern;
import org.springframework.web.util.pattern.PathPatternParser;

/** Shared parsed/canonical boundary for the mapped Auth POST routes. */
final class AuthRequestTarget {

    private static final String INVALID_REQUEST_BODY =
            "{\"code\":\"INVALID_REQUEST\",\"message\":\"The request is invalid\"}";

    private AuthRequestTarget() {
    }

    static Match resolve(HttpServletRequest request) {
        if (request == null || !"POST".equalsIgnoreCase(request.getMethod())) {
            return Match.notTarget();
        }

        RequestPath requestPath;
        try {
            requestPath = ServletRequestPathUtils.parse(request);
        } catch (IllegalArgumentException e) {
            return Match.malformed();
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
