package com.virtualcompanion.runtime.auth.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import jakarta.servlet.FilterChain;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * Unit tests for {@link OwnerInjectionFilter}. The {@link OwnerContext}
 * collaborator is mocked (the GUC SQL is already proven by {@code OwnerContextTest}
 * and the V17 DB tests); these tests prove the filter wires the authenticated
 * JWT principal's accountId into {@code asOwner} and continues the chain in
 * every other case without fabricating an owner context.
 */
class OwnerInjectionFilterTest {

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void injectsOwnerForAuthenticatedJwtPrincipalAndContinuesChain() throws Exception {
        OwnerContext ownerContext = mock(OwnerContext.class);
        // asOwner runs the work inline so we can observe the chain running inside it.
        doAnswer(invocation -> {
            Runnable work = invocation.getArgument(1);
            work.run();
            return null;
        }).when(ownerContext).asOwner(eq(42L), any(Runnable.class));
        FilterChain chain = mock(FilterChain.class);
        AtomicBoolean chainRan = new AtomicBoolean(false);
        doAnswer(inv -> {
            chainRan.set(true);
            return null;
        }).when(chain).doFilter(any(), any());
        bindPrincipal(new JwtTokenService.Principal(42L, "USER", "alice"));

        new OwnerInjectionFilter(stubProvider(ownerContext))
                .doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);

        verify(ownerContext).asOwner(eq(42L), any(Runnable.class));
        assertThat(chainRan.get()).isTrue();
    }

    @Test
    void skipsInjectionWhenSecurityContextIsEmpty() throws Exception {
        OwnerContext ownerContext = mock(OwnerContext.class);
        FilterChain chain = mock(FilterChain.class);
        SecurityContextHolder.clearContext(); // anonymous / unauthenticated

        new OwnerInjectionFilter(stubProvider(ownerContext))
                .doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);

        verify(ownerContext, never()).asOwner(anyLong(), any());
        verify(chain).doFilter(any(), any());
    }

    @Test
    void skipsInjectionWhenPrincipalIsNotJwtPrincipal() throws Exception {
        OwnerContext ownerContext = mock(OwnerContext.class);
        FilterChain chain = mock(FilterChain.class);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken("not-a-jwt-principal", null, List.of()));

        new OwnerInjectionFilter(stubProvider(ownerContext))
                .doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);

        verify(ownerContext, never()).asOwner(anyLong(), any());
        verify(chain).doFilter(any(), any());
    }

    @Test
    void noopWhenOwnerContextBeanIsAbsent() throws Exception {
        // auth.enabled=true but datasource-enabled=false: OwnerContext bean
        // missing -- filter must still serve the chain without injecting an owner.
        FilterChain chain = mock(FilterChain.class);
        bindPrincipal(new JwtTokenService.Principal(42L, "USER", "alice"));

        new OwnerInjectionFilter(stubProvider(null))
                .doFilterInternal(new MockHttpServletRequest(), new MockHttpServletResponse(), chain);

        verify(chain).doFilter(any(), any());
    }

    private static void bindPrincipal(JwtTokenService.Principal principal) {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, List.of()));
    }

    private static ObjectProvider<OwnerContext> stubProvider(OwnerContext available) {
        @SuppressWarnings("unchecked")
        ObjectProvider<OwnerContext> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(available);
        return provider;
    }
}
