package com.virtualcompanion.runtime.auth.web;

import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.config.CookieCsrfGuardFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.LoginRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import com.virtualcompanion.runtime.auth.web.AuthResponses.LogoutResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.security.SecureRandom;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Identity endpoints. Login and refresh are public; logout and admin account
 * creation require a valid Bearer access token (the caller identity always
 * comes from the server-verified principal, never from a request field).
 *
 * <p>The controller is intentionally thin -- all fail-closed rules live in
 * {@link AuthService} and the V14 SECURITY DEFINER functions. Session cookies
 * (HttpOnly {@code vc_refresh} + double-submit {@code vc_csrf}) are set and
 * cleared here; the refresh token never leaves the cookie into a response
 * body. It only exists when the auth subsystem is enabled AND a DataSource is
 * wired (virtual-companion.auth.datasource-enabled=true), because it depends
 * on the database-backed AuthService; otherwise it is absent and the endpoints
 * 404.
 */
@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnProperty(name = "virtual-companion.auth.datasource-enabled", havingValue = "true")
public class AuthController {

    private static final String SAME_SITE_LAX = "Lax";
    private static final String REFRESH_COOKIE_PATH = "/api/v1/auth";

    private final AuthService authService;

    /**
     * Secure flag for the session cookies. Field-injected so the bean can be
     * constructed manually by {@code AuthDataSourceConfig} without a second
     * constructor parameter; default true (production), local HTTP development
     * sets VC_AUTH_COOKIE_SECURE=false.
     */
    @Value("${virtual-companion.auth.cookie-secure:true}")
    private boolean cookieSecure;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request, HttpServletResponse response) {
        IssuedSession session = authService.login(request.username(), request.password());
        setSessionCookies(response, session.refreshToken());
        return session.response();
    }

    @PostMapping("/refresh")
    public AuthResponse refresh(
            @CookieValue(name = CookieCsrfGuardFilter.REFRESH_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        IssuedSession session = authService.refresh(refreshToken);
        setSessionCookies(response, session.refreshToken());
        return session.response();
    }

    @PostMapping("/logout")
    public LogoutResponse logout(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @CookieValue(name = CookieCsrfGuardFilter.REFRESH_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        clearSessionCookies(response);
        return authService.logout(principal.accountId(), refreshToken);
    }

    @PostMapping("/admin/accounts")
    public AccountResponse createAccount(
            @RequestBody CreateAccountRequest request,
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.createAccount(principal, request);
    }

    /**
     * Set the HttpOnly refresh cookie (JS-unreadable, SameSite=Lax, Secure per
     * config, scoped to the auth path) and the non-HttpOnly double-submit CSRF
     * cookie (readable by the frontend so it can echo it back as
     * {@code X-CSRF-Token}). Both rotate with every login/refresh.
     */
    private void setSessionCookies(HttpServletResponse response, String refreshToken) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(
                        CookieCsrfGuardFilter.REFRESH_COOKIE, refreshToken)
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite(SAME_SITE_LAX)
                .path(REFRESH_COOKIE_PATH)
                .maxAge(authService.refreshTtlSeconds())
                .build().toString());
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(
                        CookieCsrfGuardFilter.CSRF_COOKIE, generateCsrfValue())
                .httpOnly(false)
                .secure(cookieSecure)
                .sameSite(SAME_SITE_LAX)
                .path("/")
                .maxAge(authService.refreshTtlSeconds())
                .build().toString());
    }

    private void clearSessionCookies(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(
                        CookieCsrfGuardFilter.REFRESH_COOKIE, "")
                .httpOnly(true)
                .secure(cookieSecure)
                .sameSite(SAME_SITE_LAX)
                .path(REFRESH_COOKIE_PATH)
                .maxAge(0)
                .build().toString());
        response.addHeader(HttpHeaders.SET_COOKIE, ResponseCookie.from(
                        CookieCsrfGuardFilter.CSRF_COOKIE, "")
                .httpOnly(false)
                .secure(cookieSecure)
                .sameSite(SAME_SITE_LAX)
                .path("/")
                .maxAge(0)
                .build().toString());
    }

    private static String generateCsrfValue() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
