package com.virtualcompanion.runtime.auth.config;

import com.virtualcompanion.platform.persistence.SensitiveRouteAdmission;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthRateLimitResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpMethod;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * S0-30: shared DB admission for generation / SSE / export / report.
 * Emergency-contact and other routes are never limited here. Without a
 * datasource the filter no-ops so the no-DB test context stays free of
 * PostgreSQL.
 */
public final class SensitiveRouteAdmissionFilter extends OncePerRequestFilter {

    static final int GENERATION_LIMIT = 20;
    static final int GENERATION_MAX_CONCURRENT = 4;
    static final int SSE_LIMIT = 10;
    static final int EXPORT_LIMIT = 5;
    static final int REPORT_LIMIT = 10;
    static final int SHORT_WINDOW_SECONDS = 60;
    static final int HOUR_WINDOW_SECONDS = 3600;

    private final ObjectProvider<SensitiveRouteAdmission> admission;

    public SensitiveRouteAdmissionFilter(ObjectProvider<SensitiveRouteAdmission> admission) {
        this.admission = admission;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        SensitiveRouteAdmission limiter = admission.getIfAvailable();
        RouteSpec spec = routeSpec(request);
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (limiter == null || spec == null
                || !(authentication != null
                && authentication.getPrincipal() instanceof JwtTokenService.Principal principal)) {
            filterChain.doFilter(request, response);
            return;
        }
        SensitiveRouteAdmission.Decision decision = limiter.admit(
                principal.accountId(), spec.route(), spec.limit(), spec.windowSeconds());
        if (!decision.admitted()) {
            AuthRateLimitResponse.write(response, decision.retryAfterSeconds());
            return;
        }
        if (SensitiveRouteAdmission.GENERATION.equals(spec.route())) {
            SensitiveRouteAdmission.Lease lease = limiter.acquireLease(
                    principal.accountId(), SensitiveRouteAdmission.GENERATION,
                    GENERATION_MAX_CONCURRENT, SHORT_WINDOW_SECONDS);
            if (!lease.admitted()) {
                AuthRateLimitResponse.write(response, lease.retryAfterSeconds());
                return;
            }
            try {
                filterChain.doFilter(request, response);
            } finally {
                limiter.releaseLease(principal.accountId(), lease.leaseId());
            }
            return;
        }
        filterChain.doFilter(request, response);
    }

    private static RouteSpec routeSpec(HttpServletRequest request) {
        String path = request.getRequestURI();
        if (path == null) {
            return null;
        }
        if (path.contains("/emergency-contact")) {
            return null;
        }
        String method = request.getMethod();
        if (HttpMethod.POST.matches(method)
                && path.contains("/conversations/")
                && path.endsWith("/generations")) {
            return new RouteSpec(
                    SensitiveRouteAdmission.GENERATION, GENERATION_LIMIT, SHORT_WINDOW_SECONDS);
        }
        if (HttpMethod.GET.matches(method) && path.contains("/realtime/streams/")) {
            return new RouteSpec(SensitiveRouteAdmission.SSE, SSE_LIMIT, SHORT_WINDOW_SECONDS);
        }
        if (HttpMethod.POST.matches(method) && path.endsWith("/exports")) {
            return new RouteSpec(SensitiveRouteAdmission.EXPORT, EXPORT_LIMIT, HOUR_WINDOW_SECONDS);
        }
        if (HttpMethod.POST.matches(method) && path.endsWith("/reports")) {
            return new RouteSpec(SensitiveRouteAdmission.REPORT, REPORT_LIMIT, HOUR_WINDOW_SECONDS);
        }
        return null;
    }

    private record RouteSpec(String route, int limit, int windowSeconds) {
    }
}
