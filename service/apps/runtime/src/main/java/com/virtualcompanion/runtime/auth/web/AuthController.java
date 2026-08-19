package com.virtualcompanion.runtime.auth.web;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.config.CookieCsrfGuardFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.LoginRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.ServiceClassAssignRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountListItem;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuditEventResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.DisableAccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import com.virtualcompanion.runtime.auth.web.AuthResponses.LogoutResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountDeletedResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.ServiceClassAssignResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.ServiceClassAssignmentItem;
import com.virtualcompanion.runtime.auth.web.AuthResponses.UsageSummaryResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Identity endpoints. Login and refresh are public; logout and admin account
 * creation require a valid Bearer access token (the caller identity always
 * comes from the server-verified principal, never from a request field).
 *
 * <p>The controller is intentionally thin -- input-key admission runs before
 * {@link AuthService}, while credential/session rules remain in the service
 * and V14 SECURITY DEFINER functions. Session cookies
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
    private final AuthAbuseGuard abuseGuard;

    /**
     * Secure flag for the session cookies. Field-injected so the bean can be
     * constructed manually by {@code AuthDataSourceConfig} without a second
     * constructor parameter; default true (production), local HTTP development
     * sets VC_AUTH_COOKIE_SECURE=false.
     */
    @Value("${virtual-companion.auth.cookie-secure:true}")
    private boolean cookieSecure;

    public AuthController(AuthService authService, AuthAbuseGuard abuseGuard) {
        this.authService = authService;
        this.abuseGuard = abuseGuard;
    }

    @PostMapping("/login")
    public AuthResponse login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse response) {
        abuseGuard.admitLogin(servletRequest.getRemoteAddr(), request.username());
        IssuedSession session = authService.login(request.username(), request.password());
        setSessionCookies(response, session.refreshToken());
        return session.response();
    }

    @PostMapping("/refresh")
    public AuthResponse refresh(
            @CookieValue(name = CookieCsrfGuardFilter.REFRESH_COOKIE, required = false) String refreshToken,
            HttpServletResponse response) {
        abuseGuard.admitRefresh(refreshToken);
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

    /**
     * ACCT-DELETE (FR-AUTH-004): self-service deletion of the caller's own
     * account. The session cookies are cleared so the client ends up logged
     * out even before the access token expires; the SD deletion is the
     * tombstone that blocks login/refresh from then on.
     */
    @DeleteMapping("/account")
    public AccountDeletedResponse deleteAccount(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            HttpServletResponse response) {
        clearSessionCookies(response);
        return authService.deleteAccount(principal.accountId());
    }

    @PostMapping("/admin/accounts")
    public AccountResponse createAccount(
            @Valid @RequestBody CreateAccountRequest request,
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.createAccount(principal, request);
    }

    /** ADMIN-ACCTS (V31): the account registry for the management UI. */
    @GetMapping("/admin/accounts")
    public List<AccountListItem> listAccounts(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.listAccounts(principal);
    }

    /** ADMIN-ACCTS (V31): flip one account to DISABLED (idempotent). */
    @PostMapping("/admin/accounts/{accountId}/disable")
    public DisableAccountResponse disableAccount(
            @PathVariable String accountId,
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.disableAccount(principal, parseAccountId(accountId));
    }

    /** ADMIN-OPS (V36): keyset page of the audit trail, newest first. */
    @GetMapping("/admin/audit")
    public List<AuditEventResponse> listAuditEvents(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", defaultValue = "50")
                    int limit) {
        Long afterId = after == null || after.isBlank() ? null : parseAccountId(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return authService.listAuditEvents(principal, afterId, safeLimit).stream()
                .map(record -> new AuditEventResponse(
                        Long.toString(record.id()),
                        record.eventType(),
                        record.accountId() == null ? null : Long.toString(record.accountId()),
                        record.username(),
                        record.occurredAt().toString()))
                .toList();
    }

    /** ADMIN-OPS (V36): per-day usage/cost summary over the window. */
    @GetMapping("/admin/usage")
    public List<UsageSummaryResponse> usageSummary(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "days", defaultValue = "14")
                    int days) {
        return authService.usageSummary(principal, days).stream()
                .map(record -> new UsageSummaryResponse(
                        record.day().toString(),
                        record.generations(),
                        record.inputTokens(),
                        record.outputTokens(),
                        record.cost()))
                .toList();
    }

    /** SAFETY-QUEUE (V59): ADMIN-only keyset page of the safety queue, newest first. */
    @GetMapping("/admin/safety-events")
    public List<SafetyEventResponse> listSafetyEvents(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", defaultValue = "50")
                    int limit) {
        Long afterId = after == null || after.isBlank() ? null : parseAccountId(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return authService.listSafetyEvents(principal, afterId, safeLimit).stream()
                .map(record -> new SafetyEventResponse(
                        Long.toString(record.id()),
                        Long.toString(record.ownerUserId()),
                        record.generationId() == null ? null : Long.toString(record.generationId()),
                        record.stage(),
                        record.riskLevel(),
                        record.ruleId(),
                        record.createdAt().toString()))
                .toList();
    }

    /** SAFETY-QUEUE: one admin-queue row. */
    public record SafetyEventResponse(
            String id, String ownerId, String generationId, String stage,
            String riskLevel, String ruleId, String createdAt) {
    }

    /** ENT-SNAP (V40): ADMIN-only simulated service-class assignment. */
    @PostMapping("/admin/service-class")
    public ServiceClassAssignResponse assignServiceClass(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @RequestBody ServiceClassAssignRequest request) {
        if (request == null) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A request body is required");
        }
        String serviceClass = com.virtualcompanion.platform.persistence
                .EntitlementSnapshotService.normalizeServiceClass(request.serviceClass());
        long target = parseAccountId(request.accountId());
        boolean assigned = authService.assignServiceClass(principal, target, serviceClass);
        if (!assigned) {
            throw new AuthErrorException(HttpStatus.NOT_FOUND, "NOT_FOUND_OR_FORBIDDEN",
                    "Target account unavailable");
        }
        return new ServiceClassAssignResponse(request.accountId(), serviceClass);
    }

    /** ENT-SNAP (V40): ADMIN-only assignment registry read. */
    @GetMapping("/admin/service-classes")
    public List<ServiceClassAssignmentItem> listServiceClassAssignments(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.listServiceClassAssignments(principal).stream()
                .map(record -> new ServiceClassAssignmentItem(
                        Long.toString(record.accountId()),
                        record.username(),
                        record.serviceClass(),
                        record.assignedAt() == null ? null : record.assignedAt().toString(),
                        record.updatedAt() == null ? null : record.updatedAt().toString()))
                .toList();
    }

    private static long parseAccountId(String raw) {
        try {
            long parsed = Long.parseLong(raw);
            if (parsed <= 0) {
                throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                        "A valid target account id is required");
            }
            return parsed;
        } catch (NumberFormatException e) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A valid target account id is required");
        }
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
