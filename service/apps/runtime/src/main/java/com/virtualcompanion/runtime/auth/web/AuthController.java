package com.virtualcompanion.runtime.auth.web;

import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.LoginRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.LogoutRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.RefreshTokenRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.LogoutResponse;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
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
 * {@link AuthService} and the V14 SECURITY DEFINER functions. It only exists
 * when the auth subsystem is enabled AND a DataSource is wired
 * (virtual-companion.auth.datasource-enabled=true), because it depends on the
 * database-backed AuthService; otherwise it is absent and the endpoints 404.
 */
@RestController
@RequestMapping("/api/v1/auth")
@ConditionalOnProperty(name = "virtual-companion.auth.datasource-enabled", havingValue = "true")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/login")
    public AuthResponse login(@RequestBody LoginRequest request) {
        return authService.login(request.username(), request.password());
    }

    @PostMapping("/refresh")
    public AuthResponse refresh(@RequestBody RefreshTokenRequest request) {
        return authService.refresh(request.refreshToken());
    }

    @PostMapping("/logout")
    public LogoutResponse logout(
            @RequestBody LogoutRequest request,
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.logout(principal.accountId(), request.refreshToken());
    }

    @PostMapping("/admin/accounts")
    public AccountResponse createAccount(
            @RequestBody CreateAccountRequest request,
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.createAccount(principal, request);
    }
}
