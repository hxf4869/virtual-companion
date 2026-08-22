package com.virtualcompanion.runtime.auth.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtAuthenticationFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.tenant.OwnerInjectionFilter;
import com.virtualcompanion.runtime.auth.web.AuthController;
import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import jakarta.servlet.Filter;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.web.FilterChainProxy;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;

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

    @Autowired
    private AuthAbuseGuard authAbuseGuard;

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
    void oversizedPublicLoginBodyIsRejectedByTheRegisteredFilter() throws Exception {
        byte[] body = new byte[AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1];
        Arrays.fill(body, (byte) 'x');

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType("application/json")
                        .content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                .andExpect(jsonPath("$.message").value("The request is invalid"));
    }

    @Test
    void authBoundaryRejectsNonCanonicalMappedPathsBeforeMvcRouting() throws Exception {
        byte[] body = new byte[AuthInputLimits.MAX_REQUEST_BODY_BYTES + 1];
        Arrays.fill(body, (byte) 'x');

        for (String path : List.of(
                "/api/v1/auth/l%6Fgin",
                "/api/v1/auth/login;v=1",
                "/api/v1/auth/refr%65sh",
                "/api/v1/auth/logout;v=1",
                "/api/v1/%61uth/admin/accounts",
                "/api/v1/auth/admin/acc%6Funts",
                "/api/v1/auth/admin/acc%6funts",
                "/api/v1/auth/admin/accounts;v=1")) {
            mockMvc.perform(post(URI.create(path))
                            .contentType("application/json")
                            .content(body))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"))
                    .andExpect(jsonPath("$.message").value("The request is invalid"));
        }
    }

    @Test
    void admissionFiltersHaveOneSecurityChainRegistrationInTheFrozenOrder() {
        List<Filter> filters = springSecurityFilterChain.getFilterChains().stream()
                .flatMap(chain -> chain.getFilters().stream())
                .toList();

        int cookieIndex = indexOf(filters, CookieCsrfGuardFilter.class);
        int sourceIndex = indexOf(filters, AuthSourceAdmissionFilter.class);
        int bodyIndex = indexOf(filters, AuthRequestBodyLimitFilter.class);
        assertThat(cookieIndex).isGreaterThanOrEqualTo(0);
        assertThat(sourceIndex).isGreaterThan(cookieIndex);
        assertThat(bodyIndex).isGreaterThan(sourceIndex);
        assertThat(count(filters, CookieCsrfGuardFilter.class)).isEqualTo(1);
        assertThat(count(filters, AuthSourceAdmissionFilter.class)).isEqualTo(1);
        assertThat(count(filters, AuthRequestBodyLimitFilter.class)).isEqualTo(1);
        assertThat(context.getBeansOfType(CookieCsrfGuardFilter.class)).isEmpty();
        assertThat(context.getBeansOfType(AuthSourceAdmissionFilter.class)).isEmpty();
        assertThat(context.getBeansOfType(AuthRequestBodyLimitFilter.class)).isEmpty();
    }

    @Test
    void ownerInjectionFilterIsRegisteredAfterJwtAuthenticationFilter() {
        List<Filter> filters = springSecurityFilterChain.getFilterChains().stream()
                .flatMap(chain -> chain.getFilters().stream())
                .toList();

        int jwtIndex = indexOf(filters, JwtAuthenticationFilter.class);
        int ownerIndex = indexOf(filters, OwnerInjectionFilter.class);
        assertThat(jwtIndex).isGreaterThanOrEqualTo(0);
        assertThat(ownerIndex).isGreaterThan(jwtIndex);
        assertThat(count(filters, OwnerInjectionFilter.class)).isEqualTo(1);
    }

    @Test
    void internalMeEchoesAuthenticatedPrincipal() throws Exception {
        // auth.enabled=true without a DataSource: OwnerContext bean is absent so
        // OwnerInjectionFilter no-ops, but the principal still flows to the
        // controller -- proving the filter -> principal -> controller wiring.
        String token = jwtTokenService.issueAccessToken(7L, "USER", "alice");

        mockMvc.perform(get("/api/internal/me")
                        .header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ownerUserId").value(7))
                .andExpect(jsonPath("$.role").value("USER"));
    }

    @Test
    void internalMeRejectsUnauthenticatedRequest() throws Exception {
        mockMvc.perform(get("/api/internal/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void datasourceControllerFactoryReceivesTheSameSingletonGuard() {
        AuthService authService = mock(AuthService.class);
        AuthController controller = new AuthDataSourceConfig().authController(
                authService, authAbuseGuard, com.virtualcompanion.runtime.observability.TestAlerts.props(), null);

        assertThat(ReflectionTestUtils.getField(controller, "authService"))
                .isSameAs(authService);
        assertThat(ReflectionTestUtils.getField(controller, "abuseGuard"))
                .isSameAs(authAbuseGuard);
    }

    @Test
    void corsAllowsPutAndKeepsCredentialsDisabledWithoutWildcard() {
        CorsConfigurationSource source = context.getBean(
                "corsConfigurationSource", CorsConfigurationSource.class);
        MockHttpServletRequest request = new MockHttpServletRequest("PUT", "/api/v1/consents");
        CorsConfiguration cors = source.getCorsConfiguration(request);
        assertThat(cors).isNotNull();
        assertThat(cors.getAllowedMethods()).contains("PUT", "POST", "GET");
        assertThat(Boolean.TRUE.equals(cors.getAllowCredentials())).isFalse();
        assertThat(cors.getAllowedOrigins() == null ? List.of() : cors.getAllowedOrigins())
                .noneMatch(origin -> origin.contains("*"));
    }

    @Test
    void csrfFilterConstructorRejectsWildcardOrigin() {
        org.junit.jupiter.api.Assertions.assertThrows(
                IllegalStateException.class,
                () -> new CookieCsrfGuardFilter(List.of("*")));
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
        assertThat(response.getStatus()).isEqualTo(403);
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
        assertThat(response.getStatus()).isEqualTo(200);
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

    private static int indexOf(List<Filter> filters, Class<? extends Filter> type) {
        for (int i = 0; i < filters.size(); i++) {
            if (type.isInstance(filters.get(i))) {
                return i;
            }
        }
        return -1;
    }

    private static long count(List<Filter> filters, Class<? extends Filter> type) {
        return filters.stream().filter(type::isInstance).count();
    }
}
