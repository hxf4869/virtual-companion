package com.virtualcompanion.runtime.auth.web;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.config.AuthRequestBodyLimitFilter;
import com.virtualcompanion.runtime.auth.config.AuthSourceAdmissionFilter;
import com.virtualcompanion.runtime.auth.config.CookieCsrfGuardFilter;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import jakarta.servlet.http.Cookie;
import java.net.URI;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.validation.beanvalidation.LocalValidatorFactoryBean;

class AuthControllerAbuseControlTest {

    private AuthService authService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        authService = mock(AuthService.class);
        when(authService.refreshTtlSeconds()).thenReturn(604800L);
        AuthController controller = new AuthController(authService, new AuthAbuseGuard(), com.virtualcompanion.runtime.observability.TestAlerts.props());
        ReflectionTestUtils.setField(controller, "cookieSecure", true);
        LocalValidatorFactoryBean validator = new LocalValidatorFactoryBean();
        validator.afterPropertiesSet();
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setValidator(validator)
                .setControllerAdvice(new AuthExceptionHandler())
                .build();
    }

    @Test
    void canonicalLoginKeyRejectsBeforeServiceAndIgnoresForwardedHeaders() throws Exception {
        when(authService.login(anyString(), anyString())).thenReturn(session("refresh-a"));

        mockMvc.perform(post("/api/v1/auth/login")
                        .with(request -> {
                            request.setRemoteAddr("192.0.2.30");
                            return request;
                        })
                        .header("X-Forwarded-For", "198.51.100.1")
                        .contentType("application/json")
                        .content("{\"username\":\" Alice \",\"password\":\"pw\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/v1/auth/login")
                        .with(request -> {
                            request.setRemoteAddr("192.0.2.30");
                            return request;
                        })
                        .header("X-Forwarded-For", "203.0.113.200")
                        .contentType("application/json")
                        .content("{\"username\":\"alice\",\"password\":\"different\"}"))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "1"))
                .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"))
                .andExpect(jsonPath("$.message")
                        .value("Authentication is temporarily rate limited"))
                .andExpect(jsonPath("$.details").doesNotExist());

        verify(authService, times(1)).login(anyString(), anyString());
    }

    @Test
    void refreshTokenKeyRejectsBeforeRotationOrSessionJdbc() throws Exception {
        when(authService.refresh("cookie-token")).thenReturn(session("rotated-token"));
        Cookie token = new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, "cookie-token");

        mockMvc.perform(post("/api/v1/auth/refresh").cookie(token))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(token))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().string(HttpHeaders.RETRY_AFTER, "1"))
                .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"));

        verify(authService, times(1)).refresh("cookie-token");
    }

    @Test
    void refreshFencePreservesInvalid401AndAdmitsExact512Bytes() throws Exception {
        String blank = " ";
        String exact = "r".repeat(AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES);
        String oneOver = "r".repeat(AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES + 1);
        when(authService.refresh(isNull())).thenThrow(invalidRefresh());
        when(authService.refresh(blank)).thenThrow(invalidRefresh());
        when(authService.refresh(oneOver)).thenThrow(invalidRefresh());
        when(authService.refresh(exact)).thenReturn(session("rotated-exact"));

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/auth/refresh"))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
            mockMvc.perform(post("/api/v1/auth/refresh")
                            .cookie(new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, blank)))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
            mockMvc.perform(post("/api/v1/auth/refresh")
                            .cookie(new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, oneOver)))
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
        }

        Cookie exactCookie = new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, exact);
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(exactCookie))
                .andExpect(status().isOk());
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(exactCookie))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"));

        verify(authService, times(2)).refresh(isNull());
        verify(authService, times(2)).refresh(blank);
        verify(authService, times(2)).refresh(oneOver);
        verify(authService, times(1)).refresh(exact);
    }

    @Test
    void malformedJsonUsernameFailsClosedBeforeAuthService() throws Exception {
        for (String escapedSurrogate : List.of("\\ud800", "\\udc00")) {
            mockMvc.perform(post("/api/v1/auth/login")
                            .contentType("application/json")
                            .content("{\"username\":\"" + escapedSurrogate
                                    + "\",\"password\":\"pw\"}"))
                    .andExpect(status().isTooManyRequests())
                    .andExpect(header().string(HttpHeaders.RETRY_AFTER, "60"))
                    .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"));
        }

        verify(authService, times(0)).login(anyString(), anyString());
    }

    @Test
    void malformedRefreshTokenFailsClosedBeforeAuthService() throws Exception {
        for (String malformed : List.of("\uD800", "\uDC00")) {
            mockMvc.perform(post("/api/v1/auth/refresh")
                            .cookie(new Cookie(CookieCsrfGuardFilter.REFRESH_COOKIE, malformed)))
                    .andExpect(status().isTooManyRequests())
                    .andExpect(header().string(HttpHeaders.RETRY_AFTER, "60"))
                    .andExpect(jsonPath("$.code").value("AUTH_RATE_LIMITED"))
                    .andExpect(jsonPath("$.message")
                            .value("Authentication is temporarily rate limited"))
                    .andExpect(jsonPath("$.details").doesNotExist());
        }

        verify(authService, times(0)).refresh(anyString());
    }

    @Test
    void nonCanonicalLoginPathsDoNotReachTheMvcEndpoint() throws Exception {
        AuthAbuseGuard guard = new AuthAbuseGuard();
        MockMvc admissionProtectedMvc = MockMvcBuilders.standaloneSetup(
                        new AuthController(authService, guard, com.virtualcompanion.runtime.observability.TestAlerts.props()))
                .setControllerAdvice(new AuthExceptionHandler())
                .addFilters(
                        new AuthSourceAdmissionFilter(guard),
                        new AuthRequestBodyLimitFilter())
                .build();

        for (String path : List.of(
                "/api/v1/auth/l%6Fgin",
                "/api/v1/auth/login;v=1")) {
            admissionProtectedMvc.perform(post(URI.create(path))
                            .contentType("application/json")
                            .content("{\"username\":\"alice\",\"password\":\"pw\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_REQUEST"));
        }
        verify(authService, times(0)).login(anyString(), anyString());
    }

    private static IssuedSession session(String refreshToken) {
        return new IssuedSession(
                new AuthResponse("access-token", "Bearer", 7200, "7", "USER", false),
                refreshToken);
    }

    private static AuthErrorException invalidRefresh() {
        return new AuthErrorException(
                HttpStatus.UNAUTHORIZED,
                "AUTHENTICATION_REQUIRED",
                "A valid refresh token is required");
    }
}
