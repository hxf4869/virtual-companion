package com.virtualcompanion.runtime.auth.tenant;

import com.virtualcompanion.runtime.auth.jwt.JwtAuthenticationFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * P1-04 application-side owner injector (INV-TENANT-001, TASK-0168). Runs
 * immediately after {@link JwtAuthenticationFilter}: when the SecurityContext
 * holds the server-verified {@link JwtTokenService.Principal}, this filter
 * wraps the remainder of the request in {@link OwnerContext#asOwner} so the
 * transaction-scoped {@code vc.owner_user_id} GUC is bound to the caller's
 * accountId before any FORCE-RLS business query runs. The V17 SECURITY DEFINER
 * trusted-owner assertion ({@code p_owner_user_id IS DISTINCT FROM
 * vc.current_owner_id()}) thus has a server-trusted supplier at runtime.
 *
 * <p>When no {@link OwnerContext} bean is available (auth enabled but the
 * DataSource disabled -- the database-free test/baseline context), or the
 * principal is absent / not the JWT principal (anonymous request), the filter
 * is a no-op and simply continues the chain; it never fabricates an owner
 * context (RLS fails closed with a NULL {@code current_owner_id()}).
 *
 * <p>The downstream request runs inside the single transaction opened by
 * {@code asOwner} (request-scoped transaction boundary). This is the simplest
 * form that reuses the existing primitive; the transaction-scoped binding
 * ({@code set_config(..., true)}) auto-clears at commit/rollback, so a leaked
 * connection can never carry an owner into another request. The mapping is
 * direct and derived solely from the server-verified identity
 * (user_id == owner_user_id), never from a request field or a development
 * header.
 */
public class OwnerInjectionFilter extends OncePerRequestFilter {

    private final ObjectProvider<OwnerContext> ownerContextProvider;

    public OwnerInjectionFilter(ObjectProvider<OwnerContext> ownerContextProvider) {
        this.ownerContextProvider = ownerContextProvider;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        Object principal = authentication == null ? null : authentication.getPrincipal();
        OwnerContext ownerContext = ownerContextProvider.getIfAvailable();

        if (principal instanceof JwtTokenService.Principal jwtPrincipal && ownerContext != null) {
            // asOwner's work is a Runnable (no checked exceptions); capture any
            // IOException/ServletException thrown downstream and rethrow it once
            // the transaction completes, so the servlet container sees the real
            // exception and the transaction still rolls back on failure.
            final IOException[] ioFailure = new IOException[1];
            final ServletException[] servletFailure = new ServletException[1];
            ownerContext.asOwner(jwtPrincipal.accountId(), () -> {
                try {
                    filterChain.doFilter(request, response);
                } catch (IOException e) {
                    ioFailure[0] = e;
                } catch (ServletException e) {
                    servletFailure[0] = e;
                }
            });
            if (ioFailure[0] != null) {
                throw ioFailure[0];
            }
            if (servletFailure[0] != null) {
                throw servletFailure[0];
            }
        } else {
            // Anonymous request, non-JWT principal, or no DataSource wired:
            // never inject an owner context -- continue chain as-is.
            filterChain.doFilter(request, response);
        }
    }
}
