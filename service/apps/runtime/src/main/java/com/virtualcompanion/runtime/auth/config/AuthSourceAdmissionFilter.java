package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.AdmissionLease;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.Route;
import com.virtualcompanion.runtime.auth.config.AuthRequestTarget.Match;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitException;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.web.filter.OncePerRequestFilter;

/** Canonical Auth route boundary plus source admission for exact login/refresh routes. */
public final class AuthSourceAdmissionFilter extends OncePerRequestFilter {

    static final String LOGIN_PATH = "/api/v1/auth/login";
    static final String REFRESH_PATH = "/api/v1/auth/refresh";

    private final AuthAbuseGuard guard;

    public AuthSourceAdmissionFilter(AuthAbuseGuard guard) {
        this.guard = guard;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        Match match = AuthRequestTarget.resolve(request);
        if (match.rejected()) {
            AuthRequestTarget.reject(response);
            return;
        }
        if (!match.canonical() || !match.route().sourceAdmission()) {
            chain.doFilter(request, response);
            return;
        }

        Route route = match.route() == AuthRequestTarget.Route.LOGIN
                ? Route.LOGIN
                : Route.REFRESH;

        AdmissionLease lease;
        try {
            lease = guard.admitSource(route, request.getRemoteAddr());
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
}
