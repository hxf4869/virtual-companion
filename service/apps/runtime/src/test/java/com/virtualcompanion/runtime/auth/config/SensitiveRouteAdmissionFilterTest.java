package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.SensitiveRouteAdmission;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

class SensitiveRouteAdmissionFilterTest {

    @AfterEach
    void clear() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void generationPostIsLimited() throws Exception {
        SensitiveRouteAdmission limiter = mock(SensitiveRouteAdmission.class);
        when(limiter.admit(anyLong(), anyString(), anyInt(), anyInt()))
                .thenReturn(new SensitiveRouteAdmission.Decision(false, 9));
        bindPrincipal();
        SensitiveRouteAdmissionFilter filter = new SensitiveRouteAdmissionFilter(provider(limiter));
        MockHttpServletRequest request = new MockHttpServletRequest(
                "POST", "/api/v1/conversations/5/generations");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).isEqualTo("9");
        verify(limiter).admit(7L, SensitiveRouteAdmission.GENERATION, 20, 60);
    }

    @Test
    void emergencyContactIsNeverLimited() throws Exception {
        SensitiveRouteAdmission limiter = mock(SensitiveRouteAdmission.class);
        bindPrincipal();
        SensitiveRouteAdmissionFilter filter = new SensitiveRouteAdmissionFilter(provider(limiter));
        MockHttpServletRequest request = new MockHttpServletRequest(
                "POST", "/api/v1/emergency-contact/verify-start");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(200);
        verify(limiter, never()).admit(anyLong(), anyString(), anyInt(), anyInt());
    }

    @Test
    void missingDatasourceIsANoOp() throws Exception {
        bindPrincipal();
        SensitiveRouteAdmissionFilter filter = new SensitiveRouteAdmissionFilter(provider(null));
        MockHttpServletRequest request = new MockHttpServletRequest(
                "POST", "/api/v1/conversations/5/generations");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getStatus()).isEqualTo(200);
    }

    @SuppressWarnings("unchecked")
    private static ObjectProvider<SensitiveRouteAdmission> provider(SensitiveRouteAdmission value) {
        ObjectProvider<SensitiveRouteAdmission> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(value);
        return provider;
    }

    private static void bindPrincipal() {
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(
                        new JwtTokenService.Principal(7L, "USER", "alice"), null, java.util.List.of()));
    }
}
