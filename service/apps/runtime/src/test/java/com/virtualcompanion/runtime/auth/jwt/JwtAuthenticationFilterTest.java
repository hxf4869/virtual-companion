package com.virtualcompanion.runtime.auth.jwt;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

class JwtAuthenticationFilterTest {

    private static final String SECRET =
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    private JwtTokenService service() {
        return new JwtTokenService(SECRET, Duration.ofHours(2), "virtual-companion");
    }

    @Test
    void validBearerTokenBindsServerDerivedPrincipalAndRole() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(service());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + service().issueAccessToken(7L, "ADMIN", "root"));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        assertThat(authentication).isNotNull();
        assertThat(authentication.getPrincipal()).isInstanceOf(JwtTokenService.Principal.class);
        JwtTokenService.Principal principal = (JwtTokenService.Principal) authentication.getPrincipal();
        assertThat(principal.accountId()).isEqualTo(7L);
        assertThat(principal.role()).isEqualTo("ADMIN");
        assertThat(authentication.getAuthorities())
                .extracting("authority")
                .containsExactly("ROLE_ADMIN");
    }

    @Test
    void missingHeaderLeavesSecurityContextEmpty() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(service());
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void invalidTokenLeavesSecurityContextEmpty() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(service());
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer not-a-valid-token");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void expiredTokenLeavesSecurityContextEmpty() throws Exception {
        JwtTokenService shortLived = new JwtTokenService(SECRET, Duration.ofNanos(1), "virtual-companion");
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(shortLived);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization", "Bearer " + shortLived.issueAccessToken(7L, "USER", "alice"));
        Thread.sleep(2);
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }
}
