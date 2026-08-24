package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.AdmissionLease;
import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard.Route;
import com.virtualcompanion.runtime.auth.application.SharedSourceAdmission;
import com.virtualcompanion.runtime.auth.config.AuthRequestTarget.Match;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitException;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.web.filter.OncePerRequestFilter;

/** Canonical Auth route boundary plus source admission for exact login/refresh routes. */
public final class AuthSourceAdmissionFilter extends OncePerRequestFilter {

    static final String LOGIN_PATH = "/api/v1/auth/login";
    static final String REFRESH_PATH = "/api/v1/auth/refresh";
    static final int SHARED_LOGIN_LIMIT = 10;
    static final int SHARED_REFRESH_LIMIT = 10;
    static final int SHARED_WINDOW_SECONDS = 60;

    private final AuthAbuseGuard guard;
    private final ObjectProvider<SharedSourceAdmission> sharedAdmission;

    public AuthSourceAdmissionFilter(AuthAbuseGuard guard) {
        this(guard, null);
    }

    public AuthSourceAdmissionFilter(
            AuthAbuseGuard guard, ObjectProvider<SharedSourceAdmission> sharedAdmission) {
        this.guard = guard;
        this.sharedAdmission = sharedAdmission;
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
            SharedSourceAdmission shared =
                    sharedAdmission == null ? null : sharedAdmission.getIfAvailable();
            if (shared != null) {
                try {
                    int limit = route == Route.LOGIN
                            ? SHARED_LOGIN_LIMIT : SHARED_REFRESH_LIMIT;
                    SharedSourceAdmission.Decision decision = shared.admit(
                            route.name(), request.getRemoteAddr(), limit, SHARED_WINDOW_SECONDS);
                    if (!decision.admitted()) {
                        AuthRateLimitResponse.write(response, decision.retryAfterSeconds());
                        return;
                    }
                } catch (RuntimeException sharedFailure) {
                    AuthRateLimitResponse.write(
                            response, AuthAbuseGuard.CAPACITY_RETRY_SECONDS);
                    return;
                }
            }
            chain.doFilter(request, response);
        }
    }
}
