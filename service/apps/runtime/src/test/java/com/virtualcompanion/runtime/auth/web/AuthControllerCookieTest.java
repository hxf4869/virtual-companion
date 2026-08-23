package com.virtualcompanion.runtime.auth.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.config.CookieCsrfGuardFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import com.virtualcompanion.runtime.auth.web.AuthResponses.LogoutResponse;
import jakarta.servlet.http.Cookie;
import org.springframework.test.util.ReflectionTestUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.core.MethodParameter;
import org.springframework.security.core.annotation.AuthenticationPrincipal;

/**
 * Standalone controller test for the session-cookie mechanics (P1-09, Owner
 * decision 2026-08-08): the refresh token is delivered ONLY through the
 * HttpOnly {@code vc_refresh} cookie, the double-submit {@code vc_csrf} cookie
 * is non-HttpOnly, refresh reads the cookie (never the body), and the response
 * body never contains a refresh token. The CSRF/Origin filter itself is
 * covered by {@code AuthSecurityIntegrationTest}.
 */
class AuthControllerCookieTest {

    private AuthService authService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        when(authService.refreshTtlSeconds()).thenReturn(604800L);
        AuthController controller = new AuthController(authService, new AuthAbuseGuard(), com.virtualcompanion.runtime.observability.TestAlerts.props());
        ReflectionTestUtils.setField(controller, "cookieSecure", true);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new AuthExceptionHandler())
                .setCustomArgumentResolvers(new HandlerMethodArgumentResolver() {
                    @Override
                    public boolean supportsParameter(MethodParameter parameter) {
                        return parameter.hasParameterAnnotation(AuthenticationPrincipal.class);
                    }

                    @Override
                    public Object resolveArgument(MethodParameter parameter,
                            ModelAndViewContainer mavContainer, NativeWebRequest webRequest,
                            WebDataBinderFactory binderFactory) {
                        return new JwtTokenService.Principal(7, "USER", "alice");
                    }
                })
                .build();
    }

    @Test
    void loginDeliversRefreshTokenOnlyThroughHttpOnlyCookie() throws Exception {
        when(authService.login("alice", "pw"))
                .thenReturn(new IssuedSession(sampleResponse(), "refresh-secret-token"));

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"alice\",\"password\":\"pw\"}"))
                .andExpect(status().isOk())
                .andExpect(cookie().value(CookieCsrfGuardFilter.REFRESH_COOKIE, "refresh-secret-token"))
                .andExpect(cookie().httpOnly(CookieCsrfGuardFilter.REFRESH_COOKIE, true))
                .andExpect(cookie().secure(CookieCsrfGuardFilter.REFRESH_COOKIE, true))
                .andExpect(cookie().maxAge(CookieCsrfGuardFilter.REFRESH_COOKIE, 604800))
                .andExpect(cookie().path(CookieCsrfGuardFilter.REFRESH_COOKIE, "/api/v1/auth"))
                .andExpect(header().string(HttpHeaders.SET_COOKIE,
                        org.hamcrest.Matchers.containsString("SameSite=Lax")))
                .andExpect(jsonPath("$.accessToken").value("access-token"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(jsonPath("$.accountId").value("7"));
    }

    @Test
    void loginSetsNonHttpOnlyDoubleSubmitCsrfCookie() throws Exception {
        when(authService.login("alice", "pw"))
                .thenReturn(new IssuedSession(sampleResponse(), "refresh-secret-token"));

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType("application/json")
                        .content("{\"username\":\"alice\",\"password\":\"pw\"}"))
                .andExpect(status().isOk())
                .andExpect(cookie().httpOnly(CookieCsrfGuardFilter.CSRF_COOKIE, false))
                .andExpect(cookie().path(CookieCsrfGuardFilter.CSRF_COOKIE, "/"))
                .andExpect(cookie().secure(CookieCsrfGuardFilter.CSRF_COOKIE, true))
                .andExpect(cookie().maxAge(CookieCsrfGuardFilter.CSRF_COOKIE, 604800));
    }

    @Test
    void refreshReadsTheRefreshTokenFromTheCookie() throws Exception {
        when(authService.refresh("cookie-token"))
                .thenReturn(new IssuedSession(sampleResponse(), "rotated-token"));

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .cookie(new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, "cookie-token")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andExpect(jsonPath("$.accessToken").value("access-token"))
                .andExpect(cookie().value(CookieCsrfGuardFilter.REFRESH_COOKIE, "rotated-token"));

        verify(authService).refresh("cookie-token");
    }

    @Test
    void refreshWithoutCookieFailsClosedToAuthenticationRequired() throws Exception {
        when(authService.refresh(isNull())).thenThrow(new AuthErrorException(
                HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED",
                "A valid refresh token is required"));

        mockMvc.perform(post("/api/v1/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void logoutClearsBothSessionCookies() throws Exception {
        when(authService.logout(7, "cookie-token")).thenReturn(new LogoutResponse(true));

        mockMvc.perform(post("/api/v1/auth/logout")
                        .cookie(
                                new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, "cookie-token"),
                                new Cookie(CookieCsrfGuardFilter.CSRF_COOKIE, "csrf-value")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(cookie().maxAge(CookieCsrfGuardFilter.REFRESH_COOKIE, 0))
                .andExpect(cookie().maxAge(CookieCsrfGuardFilter.CSRF_COOKIE, 0));
    }

    @Test
    void deleteAccountClearsBothSessionCookies() throws Exception {
        when(authService.deleteAccount(7))
                .thenReturn(new AuthResponses.AccountDeletedResponse(true));

        mockMvc.perform(delete("/api/v1/auth/account")
                        .cookie(
                                new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, "cookie-token"),
                                new Cookie(CookieCsrfGuardFilter.CSRF_COOKIE, "csrf-value")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.ok").value(true))
                .andExpect(cookie().maxAge(CookieCsrfGuardFilter.REFRESH_COOKIE, 0))
                .andExpect(cookie().maxAge(CookieCsrfGuardFilter.CSRF_COOKIE, 0));
        verify(authService).deleteAccount(7);
    }

    private static AuthResponse sampleResponse() {
        return new AuthResponse("access-token", "Bearer", 7200, "7", "USER", false);
    }
}
