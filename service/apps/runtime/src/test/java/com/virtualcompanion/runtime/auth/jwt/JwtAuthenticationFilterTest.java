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
        assertThat(principal.sessionEpoch()).isEqualTo(1L);
        assertThat(authentication.getAuthorities())
                .extracting("authority")
                .containsExactly("ROLE_ADMIN");
    }

    @Test
    void epochMismatchLeavesSecurityContextEmpty() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> java.util.Optional.of(
                        new AccessSnapshot("ACTIVE", 2L, "USER")));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization",
                "Bearer " + service().issueAccessToken(7L, "USER", "alice", 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void disabledAccountLeavesSecurityContextEmpty() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> java.util.Optional.of(
                        new AccessSnapshot("DISABLED", 1L, "USER")));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization",
                "Bearer " + service().issueAccessToken(7L, "USER", "alice", 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void unreadableAuthorityFailsClosed() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> {
                    throw new IllegalStateException("authority unavailable");
                });
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization",
                "Bearer " + service().issueAccessToken(7L, "USER", "alice", 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void matchingEpochAndActiveStatusBindPrincipal() throws Exception {
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> java.util.Optional.of(
                        new AccessSnapshot("ACTIVE", 3L, "USER")));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization",
                "Bearer " + service().issueAccessToken(7L, "USER", "alice", 3L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        assertThat(authentication).isNotNull();
        JwtTokenService.Principal principal = (JwtTokenService.Principal) authentication.getPrincipal();
        assertThat(principal.sessionEpoch()).isEqualTo(3L);
    }

    @Test
    void roleDemotionWithoutEpochBumpLeavesSecurityContextEmpty() throws Exception {
        // S0-30: a demoted account (ADMIN→USER) whose epoch was not bumped
        // must still fail closed — the snapshot role must equal the token
        // role, so an old ADMIN JWT cannot ride out its remaining lifetime.
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> java.util.Optional.of(
                        new AccessSnapshot("ACTIVE", 1L, "USER")));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Authorization",
                "Bearer " + service().issueAccessToken(7L, "ADMIN", "root", 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void passwordMustChangeBlocksBusinessPathsWith403() throws Exception {
        // S0-15 review-fix: an admin-reset account must not use any business
        // endpoint until it changed its password — 403 PASSWORD_CHANGE_REQUIRED.
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> java.util.Optional.of(
                        new AccessSnapshot("ACTIVE", 1L, "USER", true)));
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setMethod("GET");
        request.setRequestURI("/api/v1/relationships");
        request.addHeader("Authorization",
                "Bearer " + service().issueAccessToken(7L, "USER", "alice", 1L));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("PASSWORD_CHANGE_REQUIRED");
    }

    @Test
    void passwordMustChangeStillAllowsTheChangeLogoutAndRefreshPaths() throws Exception {
        // The restricted session may only perform the change (or leave /
        // keep itself alive) — these paths bind the principal normally.
        JwtAuthenticationFilter filter = new JwtAuthenticationFilter(
                service(), accountId -> java.util.Optional.of(
                        new AccessSnapshot("ACTIVE", 1L, "USER", true)));
        for (String[] allowed : new String[][] {
                {"POST", "/api/v1/auth/password"},
                {"POST", "/api/v1/auth/logout"},
                {"POST", "/api/v1/auth/refresh"}}) {
            SecurityContextHolder.clearContext();
            MockHttpServletRequest request = new MockHttpServletRequest();
            request.setMethod(allowed[0]);
            request.setRequestURI(allowed[1]);
            request.addHeader("Authorization",
                    "Bearer " + service().issueAccessToken(7L, "USER", "alice", 1L));
            MockHttpServletResponse response = new MockHttpServletResponse();

            filter.doFilter(request, response, new MockFilterChain());

            assertThat(SecurityContextHolder.getContext().getAuthentication())
                    .as("allowed path %s %s", allowed[0], allowed[1])
                    .isNotNull();
        }
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
