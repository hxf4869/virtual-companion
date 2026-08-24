package com.virtualcompanion.runtime.auth.web;

import com.virtualcompanion.runtime.auth.application.AuthAbuseGuard;
import com.virtualcompanion.runtime.auth.application.AuthService;
import com.virtualcompanion.runtime.auth.config.CookieCsrfGuardFilter;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthRequests.AdminResetPasswordRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.ChangePasswordRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.LoginRequest;
import com.virtualcompanion.runtime.auth.web.AuthRequests.ReauthRequest;
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
import org.springframework.web.bind.annotation.PutMapping;
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
    private final com.virtualcompanion.runtime.observability.AlertProperties alertProperties;
    private final com.virtualcompanion.platform.persistence.OpsCase opsCase;

    /**
     * Secure flag for the session cookies. Field-injected so the bean can be
     * constructed manually by {@code AuthDataSourceConfig} without a second
     * constructor parameter; default true (production), local HTTP development
     * sets VC_AUTH_COOKIE_SECURE=false.
     */
    @Value("${virtual-companion.auth.cookie-secure:true}")
    private boolean cookieSecure;

    /**
     * INVITE (V60): invite-code registration is config-gated and disabled by
     * default — Technical Alpha keeps public registration closed; the Beta
     * deployment turns it on together with the service window.
     */
    @Value("${virtual-companion.auth.invite-registration-enabled:false}")
    private boolean inviteRegistrationEnabled;

    public AuthController(
            AuthService authService,
            AuthAbuseGuard abuseGuard,
            com.virtualcompanion.runtime.observability.AlertProperties alertProperties) {
        this(authService, abuseGuard, alertProperties, null);
    }

    public AuthController(
            AuthService authService,
            AuthAbuseGuard abuseGuard,
            com.virtualcompanion.runtime.observability.AlertProperties alertProperties,
            com.virtualcompanion.platform.persistence.OpsCase opsCase) {
        this.authService = authService;
        this.abuseGuard = abuseGuard;
        this.alertProperties = alertProperties;
        this.opsCase = opsCase;
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

    @GetMapping("/sessions")
    public List<AuthResponses.SessionListItem> listSessions(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @CookieValue(name = CookieCsrfGuardFilter.REFRESH_COOKIE, required = false) String refreshToken) {
        return authService.listSessions(principal, refreshToken);
    }

    @DeleteMapping("/sessions/{sessionId}")
    public LogoutResponse revokeSession(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @PathVariable String sessionId) {
        return authService.revokeSession(principal, sessionId);
    }

    @PostMapping("/sessions/revoke-all")
    public AuthResponses.RevokeAllResponse revokeAllSessions(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.revokeAllSessions(principal);
    }

    @PostMapping("/password")
    public AuthResponses.PasswordChangedResponse changePassword(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @Valid @RequestBody ChangePasswordRequest request,
            HttpServletResponse response) {
        AuthResponses.PasswordChangedResponse result =
                authService.changePassword(principal, request.currentPassword(), request.newPassword());
        clearSessionCookies(response);
        return result;
    }

    @PostMapping("/reauth")
    public AuthResponses.ReauthResponse reauth(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @Valid @RequestBody ReauthRequest request) {
        return authService.reauth(principal, request.password());
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

    @PostMapping("/admin/accounts/{accountId}/reset-password")
    public AuthResponses.AdminResetResponse adminResetPassword(
            @PathVariable String accountId,
            @Valid @RequestBody AdminResetPasswordRequest request,
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.adminResetPassword(principal, parseAccountId(accountId), request.newPassword());
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

    /** INVITE (V60): ADMIN mints a single-use invite code (14-day expiry). */
    @PostMapping("/admin/invites")
    public InviteResponse createInvite(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        AuthService.InviteCreated created = authService.createInviteCode(principal);
        return new InviteResponse(created.id(), created.code(), created.expiresAt().toString());
    }

    /** INVITE (V60): ADMIN registry of invite codes, newest first. */
    @GetMapping("/admin/invites")
    public List<InviteListItem> listInvites(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.listInviteCodes(principal).stream()
                .map(record -> new InviteListItem(
                        Long.toString(record.id()),
                        record.code(),
                        record.status(),
                        record.createdAt().toString(),
                        record.usedAt() == null ? null : record.usedAt().toString(),
                        record.expiresAt().toString(),
                        record.usedByAccount() == null
                                ? null : Long.toString(record.usedByAccount())))
                .toList();
    }

    /** INVITE (V60): ADMIN retires an ACTIVE invite code (idempotent). */
    @PostMapping("/admin/invites/disable")
    public InviteDisabledResponse disableInvite(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @RequestBody InviteDisableRequest request) {
        if (request == null || request.code() == null || request.code().isBlank()) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A code is required");
        }
        boolean disabled = authService.disableInviteCode(principal, request.code());
        return new InviteDisabledResponse(disabled);
    }

    /**
     * INVITE (V60): anonymous provisioning through a valid single-use code.
     * Config-gated (default off). Rate-limited through the same login guard;
     * the response never discloses whether a code exists.
     */
    @PostMapping("/invite-register")
    public AccountResponse inviteRegister(
            @Valid @RequestBody InviteRegisterRequest request,
            HttpServletRequest servletRequest) {
        if (!inviteRegistrationEnabled) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "BETA_OPERATIONS_NOT_READY",
                    "Invite registration is disabled");
        }
        abuseGuard.admitLogin(servletRequest.getRemoteAddr(), request.username());
        return authService.inviteRegister(
                request.code(), request.username(), request.password(), request.displayName());
    }

    /** ENT-TRIAL (V61): ADMIN grants a simulated PREMIUM trial budget. */
    @PostMapping("/admin/trial-grants")
    public TrialGrantResponse grantTrial(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @RequestBody TrialGrantRequest request) {
        if (request == null) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A request body is required");
        }
        long target = parseAccountId(request.accountId());
        long grantId = authService.grantTrial(principal, target,
                request.turns() == null ? 20 : request.turns(),
                request.days() == null ? 14 : request.days());
        return new TrialGrantResponse(Long.toString(grantId), true);
    }

    /** QUOTA-PERSIST (V61): ledger reconciliation over the window. */
    @GetMapping("/admin/quota-reconciliation")
    public QuotaReconciliationResponse quotaReconciliation(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "days", defaultValue = "14")
                    int days) {
        com.virtualcompanion.platform.persistence.QuotaReconciliationService.Reconciliation r =
                authService.quotaReconciliation(principal, days);
        return new QuotaReconciliationResponse(
                r.settledCount(), r.settledAmount(),
                r.releasedCount(), r.releasedAmount(),
                r.settledNotCompleted(), r.completedNotSettled(),
                r.failedWithoutRelease());
    }

    /** QUOTA-PERSIST (V61): the persisted deployment registry. */
    @GetMapping("/admin/provider-registry")
    public List<ProviderRegistryItem> providerRegistry(
            @AuthenticationPrincipal JwtTokenService.Principal principal) {
        return authService.providerRegistry(principal).stream()
                .map(record -> new ProviderRegistryItem(
                        record.providerId(),
                        record.protocol(),
                        record.admissionState(),
                        record.updatedAt().toString()))
                .toList();
    }

    /** ADMIN-BETA (V64): the report/complaint intake queue, newest first. */
    @GetMapping("/admin/reports")
    public List<BetaReportRow> listReports(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", defaultValue = "50")
                    int limit) {
        Long afterId = after == null || after.isBlank() ? null : parseAccountId(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return authService.listReports(principal, afterId, safeLimit).stream()
                .map(row -> new BetaReportRow(
                        Long.toString(row.id()),
                        Long.toString(row.ownerId()),
                        row.messageId() == null ? null : Long.toString(row.messageId()),
                        row.reason(), row.note(), row.status(),
                        row.createdAt().toString()))
                .toList();
    }

    /** ADMIN-BETA (V64): the age-appeal intake queue, newest first. */
    @GetMapping("/admin/age-appeals")
    public List<BetaAgeAppealRow> listAgeAppeals(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", defaultValue = "50")
                    int limit) {
        Long afterId = after == null || after.isBlank() ? null : parseAccountId(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return authService.listAgeAppeals(principal, afterId, safeLimit).stream()
                .map(row -> new BetaAgeAppealRow(
                        Long.toString(row.id()),
                        Long.toString(row.ownerId()),
                        row.reason(), row.status(),
                        row.createdAt().toString()))
                .toList();
    }

    /** ADMIN-BETA (V64): the async export-task queue, newest first. */
    @GetMapping("/admin/export-tasks")
    public List<BetaExportTaskRow> listExportTasks(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", defaultValue = "50")
                    int limit) {
        Long afterId = after == null || after.isBlank() ? null : parseAccountId(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return authService.listExportTasks(principal, afterId, safeLimit).stream()
                .map(row -> new BetaExportTaskRow(
                        Long.toString(row.id()),
                        Long.toString(row.ownerId()),
                        row.status(),
                        row.createdAt().toString(),
                        row.completedAt() == null ? null : row.completedAt().toString()))
                .toList();
    }

    /** ADMIN-BETA (V64): memory-anomaly sampling, newest first (read-only). */
    @GetMapping("/admin/memory-sampling")
    public List<BetaMemorySamplingRow> memorySampling(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(value = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(value = "limit", defaultValue = "50")
                    int limit) {
        Long afterId = after == null || after.isBlank() ? null : parseAccountId(after);
        int safeLimit = Math.clamp(limit, 1, 200);
        return authService.memorySampling(principal, afterId, safeLimit).stream()
                .map(row -> new BetaMemorySamplingRow(
                        Long.toString(row.id()),
                        Long.toString(row.ownerId()),
                        Long.toString(row.relationshipId()),
                        row.scope(), row.summary(), row.status(),
                        row.deletedAt() == null ? null : row.deletedAt().toString(),
                        row.createdAt().toString()))
                .toList();
    }

    /** ADMIN-BETA: one report queue row. */
    public record BetaReportRow(
            String id, String ownerId, String messageId, String reason, String note,
            String status, String createdAt) {
    }

    /** ADMIN-BETA: one age-appeal queue row. */
    public record BetaAgeAppealRow(
            String id, String ownerId, String reason, String status, String createdAt) {
    }

    /** ADMIN-BETA: one export-task row. */
    public record BetaExportTaskRow(
            String id, String ownerId, String status, String createdAt, String completedAt) {
    }

    /** ADMIN-BETA: one memory-anomaly sampling row. */
    public record BetaMemorySamplingRow(
            String id, String ownerId, String relationshipId, String scope,
            String summary, String status, String deletedAt, String createdAt) {
    }

    /** ENT-TRIAL: grant request body (defaults: 20 turns / 14 days). */
    public record TrialGrantRequest(String accountId, Integer turns, Integer days) {
    }

    /** ENT-TRIAL: grant result. */
    public record TrialGrantResponse(String grantId, boolean ok) {
    }

    /** QUOTA-PERSIST: one reconciliation result. */
    public record QuotaReconciliationResponse(
            long settledCount, long settledAmount,
            long releasedCount, long releasedAmount,
            long settledNotCompleted, long completedNotSettled,
            long failedWithoutRelease) {
    }

    /** QUOTA-PERSIST: one persisted deployment row. */
    public record ProviderRegistryItem(
            String providerId, String protocol, String admissionState, String updatedAt) {
    }

    /** INVITE: a freshly minted code. */
    public record InviteResponse(String id, String code, String expiresAt) {
    }

    /** INVITE: one registry row. */
    public record InviteListItem(
            String id, String code, String status, String createdAt, String usedAt,
            String expiresAt, String usedByAccount) {
    }

    /** INVITE: retire request body. */
    public record InviteDisableRequest(String code) {
    }

    /** INVITE: retire result. */
    public record InviteDisabledResponse(boolean ok) {
    }

    /** INVITE: anonymous registration body. */
    public record InviteRegisterRequest(
            @jakarta.validation.constraints.NotBlank String code,
            @jakarta.validation.constraints.NotBlank String username,
            @jakarta.validation.constraints.NotBlank String password,
            @jakarta.validation.constraints.NotBlank String displayName) {
    }

    /** SAFETY-QUEUE (V59): ADMIN-only keyset page of the safety queue, newest first. */
    @GetMapping("/admin/ops-cases")
    public List<java.util.Map<String, Object>> listOpsCases(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @org.springframework.web.bind.annotation.RequestParam(name = "after", required = false)
                    String after,
            @org.springframework.web.bind.annotation.RequestParam(name = "limit", required = false)
                    Integer limit) {
        if (opsCase == null || principal == null) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
        Long afterId = null;
        if (after != null && !after.isBlank()) {
            try {
                afterId = Long.parseLong(after);
            } catch (NumberFormatException bad) {
                throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                        "after is invalid");
            }
        }
        int page = limit == null ? 50 : Math.max(1, Math.min(limit, 200));
        try {
            return opsCase.list(principal.accountId(), afterId, page).stream()
                    .map(AuthController::toPublicOpsCase)
                    .toList();
        } catch (org.springframework.dao.DataAccessException denied) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
    }

    @PostMapping("/admin/ops-cases/{caseId}/actions")
    public java.util.Map<String, Object> transitionOpsCase(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @PathVariable String caseId,
            @RequestBody java.util.Map<String, String> body) {
        if (opsCase == null || principal == null) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
        long id;
        try {
            id = Long.parseLong(caseId);
        } catch (NumberFormatException bad) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "caseId is required");
        }
        String action = body == null ? null : body.get("action");
        if (action == null
                || !java.util.Set.of("ACK", "ASSIGN", "ESCALATE", "RESOLVE").contains(action)) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "action is invalid");
        }
        String assigneeRaw = body == null ? null : body.get("assigneeAccountId");
        Long assignee = null;
        if (assigneeRaw != null && !assigneeRaw.isBlank()) {
            try {
                assignee = Long.parseLong(assigneeRaw);
            } catch (NumberFormatException bad) {
                throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                        "assigneeAccountId is invalid");
            }
        }
        String disposition = body == null ? null : body.get("dispositionReason");
        if ("ASSIGN".equals(action) && assignee == null) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "assigneeAccountId is required");
        }
        if ("RESOLVE".equals(action)
                && (disposition == null || disposition.isBlank()
                        || disposition.trim().length() > 240)) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "dispositionReason is required");
        }
        try {
            opsCase.transition(principal.accountId(), id, action, assignee, disposition);
            // The OpenAPI contract declares the full OpsCase envelope for this
            // endpoint ("the case after the transition") — re-read the
            // post-transition snapshot so clients get the same masked shape
            // as GET list/snapshot instead of a narrow {id,status} pair.
            return toPublicOpsCase(opsCase.snapshot(principal.accountId(), id));
        } catch (org.springframework.dao.DataAccessException denied) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
    }

    @PutMapping("/admin/ops-cases/{caseId}/notes")
    public java.util.Map<String, Object> updateOpsCaseNote(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @PathVariable String caseId,
            @RequestBody java.util.Map<String, String> body) {
        if (opsCase == null || principal == null || body == null) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
        long id;
        try {
            id = Long.parseLong(caseId);
        } catch (NumberFormatException bad) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "caseId is invalid");
        }
        String visibility = body.get("visibility");
        String note = body.get("note");
        int max = "INTERNAL".equals(visibility) ? 500 : 240;
        if (!("INTERNAL".equals(visibility) || "PUBLIC".equals(visibility))
                || note == null || note.trim().length() > max) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "note request is invalid");
        }
        try {
            opsCase.updateNote(principal.accountId(), id, visibility, note);
            return toPublicOpsCase(opsCase.snapshot(principal.accountId(), id));
        } catch (org.springframework.dao.DataAccessException denied) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
    }

    @GetMapping("/admin/ops-cases/{caseId}/internal-note")
    public java.util.Map<String, Object> readOpsCaseInternalNote(
            @AuthenticationPrincipal JwtTokenService.Principal principal,
            @PathVariable String caseId) {
        if (opsCase == null || principal == null) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
        long id;
        try {
            id = Long.parseLong(caseId);
        } catch (NumberFormatException bad) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "caseId is invalid");
        }
        try {
            return java.util.Map.of(
                    "note", opsCase.readInternalNote(principal.accountId(), id));
        } catch (org.springframework.dao.DataAccessException denied) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "This action is not available");
        }
    }

    /** S0-14-D: never include internal notes, providerRef, or chat body. */
    static java.util.Map<String, Object> toPublicOpsCase(
            com.virtualcompanion.platform.persistence.OpsCase.Snapshot row) {
        java.util.Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("id", Long.toString(row.id()));
        out.put("kind", row.kind());
        out.put("sourceOwnerId", Long.toString(row.sourceOwnerUserId()));
        out.put("sourceId", Long.toString(row.sourceId()));
        out.put("status", row.status());
        out.put("severity", row.severity());
        if (row.slaHours() != null) {
            out.put("slaHours", row.slaHours());
        }
        if (row.assigneeAccountId() != null) {
            out.put("assigneeAccountId", Long.toString(row.assigneeAccountId()));
        }
        out.put("dispositionReason", row.dispositionReason());
        out.put("publicNote", row.publicNote());
        out.put("openedAt", row.openedAt().toString());
        return out;
    }

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
                        record.createdAt().toString(),
                        record.ageHours(),
                        isSlaBreached(record.riskLevel(), record.ageHours())))
                .toList();
    }

    /** METRICS-ALERT (V69): R3/R4 queue rows past the configured SLA hours. */
    private boolean isSlaBreached(String riskLevel, double ageHours) {
        if (riskLevel == null) {
            return false;
        }
        if (riskLevel.startsWith("R4")) {
            return ageHours > alertProperties.r4SlaHours();
        }
        if (riskLevel.startsWith("R3")) {
            return ageHours > alertProperties.r3SlaHours();
        }
        return false;
    }

    /** SAFETY-QUEUE: one admin-queue row. */
    public record SafetyEventResponse(
            String id, String ownerId, String generationId, String stage,
            String riskLevel, String ruleId, String createdAt,
            double ageHours, boolean slaBreached) {
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
