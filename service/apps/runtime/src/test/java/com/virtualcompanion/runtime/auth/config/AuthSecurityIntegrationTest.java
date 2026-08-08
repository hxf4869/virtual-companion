package com.virtualcompanion.runtime.auth.config;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import jakarta.servlet.http.Cookie;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

/**
 * Proves the Spring Security configuration loads and enforces the hybrid
 * session contract when the auth subsystem is enabled, WITHOUT a live database:
 * the security chain (including the {@link CookieCsrfGuardFilter}) is created
 * while the DataSource stays disabled, so public/CSRF/Origin rules are
 * exercised directly. Cookie issuance itself (login/refresh) is covered by the
 * standalone controller cookie test.
 *
 * <p>{@code @AutoConfigureMockMvc} is not used (it lives in a separate
 * autoconfigure artifact in this Boot line); the {@link FilterChainProxy} bean
 * (the actual Filter that owns every SecurityFilterChain) is applied to a
 * manually built MockMvc so the full application MVC stack is exercised.
 */
@SpringBootTest(properties = {
        "virtual-companion.auth.enabled=true",
        "virtual-companion.auth.jwt-secret=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
})
class AuthSecurityIntegrationTest {

    @Autowired
    private WebApplicationContext context;

    @Autowired
    private FilterChainProxy springSecurityFilterChain;

    @Autowired
    private JwtTokenService jwtTokenService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .addFilters(springSecurityFilterChain)
                .build();
    }

    @Test
    void baselineIsPublicWhenAuthEnabled() throws Exception {
        mockMvc.perform(get("/api/internal/baseline"))
                .andExpect(status().isOk());
    }

    @Test
    void baselineIsPublicEvenWithGarbageToken() throws Exception {
        mockMvc.perform(get("/api/internal/baseline")
                        .header("Authorization", "Bearer not-a-valid-token"))
                .andExpect(status().isOk());
    }

    @Test
    void otherRoutesStayProtectedWithoutBearer() throws Exception {
        mockMvc.perform(get("/api/v1/auth/anything"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void protectedRouteRejectsGarbageBearerToken() throws Exception {
        mockMvc.perform(get("/api/v1/auth/anything")
                        .header("Authorization", "Bearer not-a-valid-token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void protectedRouteAcceptsValidBearerToken() throws Exception {
        String token = jwtTokenService.issueAccessToken(7L, "USER", "alice");

        mockMvc.perform(get("/api/v1/auth/anything")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound()); // no controller without datasource; security passed
    }

    @Test
    void healthStaysPublic() throws Exception {
        mockMvc.perform(get("/actuator/health"))
                .andExpect(status().isOk());
    }

    @Test
    void csrfFilterRejectsUnknownOriginDirectly() throws Exception {
        // The CORS filter normally rejects unknown Origins before the security
        // chain; exercise the filter's own Origin branch in isolation.
        CookieCsrfGuardFilter filter = new CookieCsrfGuardFilter(List.of("https://app.example"));

        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/logout");
        request.addHeader("Origin", "https://evil.example");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());
        org.assertj.core.api.Assertions.assertThat(response.getStatus()).isEqualTo(403);
    }

    @Test
    void csrfFilterAllowsAllowedOriginAndCsrfToken() throws Exception {
        CookieCsrfGuardFilter filter = new CookieCsrfGuardFilter(List.of("https://app.example"));

        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/v1/auth/logout");
        request.addHeader("Origin", "https://app.example");
        request.setCookies(sessionCookies());
        request.addHeader(CookieCsrfGuardFilter.CSRF_HEADER, "csrf-value");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());
        org.assertj.core.api.Assertions.assertThat(response.getStatus()).isEqualTo(200);
    }

    @Test
    void stateChangingRequestWithSessionCookieRequiresCsrfToken() throws Exception {
        mockMvc.perform(post("/api/v1/auth/logout")
                        .cookie(sessionCookies()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_REJECTED"));
    }

    @Test
    void stateChangingRequestWithMismatchedCsrfTokenIsRejected() throws Exception {
        mockMvc.perform(post("/api/v1/auth/logout")
                        .cookie(sessionCookies())
                        .header(CookieCsrfGuardFilter.CSRF_HEADER, "not-the-cookie-value"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_REJECTED"));
    }

    @Test
    void stateChangingRequestWithMatchingCsrfTokenPassesTheFilter() throws Exception {
        // Filter passes; with no datasource the controller is absent and the
        // anonymous request still hits the authentication entry point: 401,
        // never 403 (CSRF cleared).
        mockMvc.perform(post("/api/v1/auth/logout")
                        .cookie(sessionCookies())
                        .header(CookieCsrfGuardFilter.CSRF_HEADER, "csrf-value"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void stateChangingRequestWithUnknownOriginIsRejected() throws Exception {
        // The CORS filter (registered ahead of the security chain) rejects the
        // unknown Origin with 403 before the CSRF filter runs; either gate
        // enforcing the allow-list satisfies the contract.
        mockMvc.perform(post("/api/v1/auth/logout")
                        .cookie(sessionCookies())
                        .header(CookieCsrfGuardFilter.CSRF_HEADER, "csrf-value")
                        .header("Origin", "https://evil.example"))
                .andExpect(status().isForbidden());
    }

    @Test
    void bearerOnlyRequestWithoutCookiesIsNotCsrfBound() throws Exception {
        // No session cookies -> no CSRF requirement; the Origin check still
        // applies only when an Origin header is present. With a valid bearer
        // the request passes the filter and routing 404s (no datasource).
        String token = jwtTokenService.issueAccessToken(7L, "USER", "alice");
        mockMvc.perform(post("/api/v1/auth/logout")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isNotFound());
    }

    private static Cookie[] sessionCookies() {
        return new Cookie[] {
                new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, "refresh-token-value"),
                new Cookie(CookieCsrfGuardFilter.CSRF_COOKIE, "csrf-value")
        };
    }
}
