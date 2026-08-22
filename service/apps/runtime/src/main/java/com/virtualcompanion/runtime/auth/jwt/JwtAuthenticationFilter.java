package com.virtualcompanion.runtime.auth.jwt;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
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
 * datasource present), the filter re-reads status and session epoch on every
 * request. A disable/logout bump or an unreadable authority leaves the
 * context empty (fail closed). Without an authority the filter stays
 * signature-only, matching the no-DB test context.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

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
                    && accessAllows(principal)
                    && SecurityContextHolder.getContext().getAuthentication() == null) {
                var authentication = new UsernamePasswordAuthenticationToken(
                        principal,
                        null,
                        List.of(new SimpleGrantedAuthority("ROLE_" + principal.role())));
                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(authentication);
            }
        }
        filterChain.doFilter(request, response);
    }

    private boolean accessAllows(JwtTokenService.Principal principal) {
        if (accessAuthority == null) {
            return true;
        }
        try {
            return accessAuthority.find(principal.accountId())
                    .map(snapshot -> snapshot.allowsAccess(principal.sessionEpoch()))
                    .orElse(false);
        } catch (RuntimeException authorityFailure) {
            return false;
        }
    }
}
