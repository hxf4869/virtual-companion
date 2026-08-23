package com.virtualcompanion.runtime.auth.jwt;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Stateless Bearer filter: reads the {@code Authorization: Bearer} header,
 * verifies the access token via {@link JwtTokenService} and, when valid, binds
 * the server-verified principal (accountId = owner_user_id, role, username) to
 * the SecurityContext as the request identity. A missing or invalid token
 * leaves the context empty and the request continues to Spring Security, which
 * rejects it with AUTHENTICATION_REQUIRED -- the principal can never come from
 * a request field or a development header (INV-TENANT-001).
 *
 * <p>S0-30: when an {@link AccessSnapshot.Authority} is wired (auth
 * datasource present), the filter re-reads status, session epoch and role on
 * every request. A disable/logout/demotion bump or an unreadable authority
 * leaves the context empty (fail closed). Without an authority the filter
 * stays signature-only, matching the no-DB test context.
 *
 * <p>S0-15 review-fix: when the snapshot carries
 * {@code password_must_change}, the session is restricted to the
 * password-change flow (plus logout/refresh) — every other request gets 403
 * {@code PASSWORD_CHANGE_REQUIRED} before any business logic runs.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    /**
     * The only requests a must-change session may make: perform the change,
     * keep the (still restricted) session alive, or leave.
     */
    private static final Set<String> MUST_CHANGE_ALLOWED = Set.of(
            "POST /api/v1/auth/password",
            "POST /api/v1/auth/logout",
            "POST /api/v1/auth/refresh");

    private final JwtTokenService tokenService;
    private final AccessSnapshot.Authority accessAuthority;

    public JwtAuthenticationFilter(JwtTokenService tokenService) {
        this(tokenService, null);
    }

    public JwtAuthenticationFilter(
            JwtTokenService tokenService, AccessSnapshot.Authority accessAuthority) {
        this.tokenService = tokenService;
        this.accessAuthority = accessAuthority;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER_PREFIX)) {
            String token = header.substring(BEARER_PREFIX.length()).trim();
            JwtTokenService.Principal principal = tokenService.verifyAccessToken(token);
            if (principal != null
                    && SecurityContextHolder.getContext().getAuthentication() == null) {
                if (accessAuthority == null) {
                    bindPrincipal(principal, request);
                } else {
                    Optional<AccessSnapshot> snapshot;
                    try {
                        snapshot = accessAuthority.find(principal.accountId());
                    } catch (RuntimeException authorityFailure) {
                        snapshot = Optional.empty();
                    }
                    if (snapshot.isPresent()
                            && snapshot.get().allowsAccess(
                                    principal.sessionEpoch(), principal.role())) {
                        if (snapshot.get().passwordMustChange()
                                && !mustChangeAllowed(request)) {
                            com.virtualcompanion.runtime.auth.web
                                    .PasswordChangeRequiredResponse.write(response);
                            return;
                        }
                        bindPrincipal(principal, request);
                    }
                }
            }
        }
        filterChain.doFilter(request, response);
    }

    /** Exact method+path match; no prefix or substring rules. */
    static boolean mustChangeAllowed(HttpServletRequest request) {
        return MUST_CHANGE_ALLOWED.contains(
                request.getMethod() + " " + request.getRequestURI());
    }

    private void bindPrincipal(
            JwtTokenService.Principal principal, HttpServletRequest request) {
        var authentication = new UsernamePasswordAuthenticationToken(
                principal,
                null,
                List.of(new SimpleGrantedAuthority("ROLE_" + principal.role())));
        authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }
}
