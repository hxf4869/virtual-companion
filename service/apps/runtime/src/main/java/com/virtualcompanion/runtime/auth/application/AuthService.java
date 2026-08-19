package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.platform.persistence.AdminConsoleService;
import com.virtualcompanion.platform.persistence.EntitlementSnapshotService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.InviteCodeService;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository.RotatedSession;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthErrorException;
import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import com.virtualcompanion.runtime.auth.web.AuthResponses.LogoutResponse;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * Identity orchestration: login / refresh / logout / ADMIN account creation,
 * backed by the V14 SECURITY DEFINER repositories and Spring Security's BCrypt.
 *
 * <p>Security-relevant rules:
 * <ul>
 *   <li>The account id IS the owner_user_id (user_id == owner_user_id); it is
 *       derived server-side from the authenticated identity and never from a
 *       request field (INV-TENANT-001).</li>
 *   <li>Unknown username and wrong password are indistinguishable and both map
 *       to NOT_FOUND_OR_FORBIDDEN; timing is equalized with a dummy BCrypt
 *       compare so the unknown-user path costs the same as a real one.</li>
 *   <li>A DISABLED account login, a revoked/expired/unknown refresh token, and
 *       a missing credential all fail closed to AUTHENTICATION_REQUIRED without
 *       disclosing the cause.</li>
 *   <li>Account creation is ADMIN-only (the DB function re-checks); duplicate
 *       usernames map to a generic error, never an existence hint.</li>
 *   <li>The raw refresh token is handed to the controller exactly once so it
 *       can be set as the HttpOnly vc_refresh cookie; it is never placed in a
 *       response body or script-readable storage, the server stores only its
 *       sha256 hash, and passwords/tokens never reach logs, URLs or the
 *       model.</li>
 * </ul>
 */
public class AuthService {

    private static final String ROLE_ADMIN = "ADMIN";
    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final int MAX_USERNAME_LENGTH = 128;
    private static final int MAX_PASSWORD_LENGTH = 1024;
    private static final int MAX_DISPLAY_NAME_LENGTH = 256;
    private static final int MAX_ROLE_LENGTH = 16;
    private static final int MIN_PASSWORD_LENGTH = 8;

    private final IdentityAccountRepository accounts;
    private final IdentityRefreshTokenRepository sessions;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenService jwt;
    private final Duration refreshTtl;
    private final String dummyHash;
    private final AdminConsoleService adminConsole;
    private final EntitlementSnapshotService entitlementSnapshotService;
    private final InviteCodeService inviteCodes;

    public AuthService(
            IdentityAccountRepository accounts,
            IdentityRefreshTokenRepository sessions,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwt,
            Duration refreshTtl,
            AdminConsoleService adminConsole,
            EntitlementSnapshotService entitlementSnapshotService,
            InviteCodeService inviteCodes) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.passwordEncoder = passwordEncoder;
        this.jwt = jwt;
        if (refreshTtl == null || refreshTtl.isZero() || refreshTtl.isNegative()) {
            throw new IllegalArgumentException("refresh TTL must be positive");
        }
        this.refreshTtl = refreshTtl;
        this.adminConsole = Objects.requireNonNull(adminConsole, "adminConsole must not be null");
        this.entitlementSnapshotService = Objects.requireNonNull(
                entitlementSnapshotService, "entitlementSnapshotService must not be null");
        this.inviteCodes = Objects.requireNonNull(inviteCodes, "inviteCodes must not be null");
        // A valid BCrypt hash so the unknown-account login path runs a real
        // (equally expensive) compare instead of short-circuiting.
        this.dummyHash = passwordEncoder.encode("virtual-companion-timing-equalization");
    }

    /**
     * Login with username+password; issues an access token and a refresh
     * session. The returned {@link IssuedSession} carries the plaintext refresh
     * token for the controller's HttpOnly cookie only.
     */
    public IssuedSession login(String username, String password) {
        validateLoginInput(username, password);
        String canonicalUsername = normalizeUsername(username);
        validateNormalizedInput(canonicalUsername, null, null);
        Optional<AuthenticatedIdentity> identity = accounts.authenticate(canonicalUsername);
        String storedHash = identity.map(AuthenticatedIdentity::passwordHash).orElse(dummyHash);
        boolean passwordOk = passwordEncoder.matches(password, storedHash);
        if (identity.isEmpty() || !passwordOk) {
            accounts.recordLoginFailure(canonicalUsername);
            throw credentialsError();
        }
        AuthenticatedIdentity account = identity.get();
        if (!STATUS_ACTIVE.equals(account.status())) {
            accounts.recordLoginFailure(canonicalUsername);
            throw disabledError();
        }
        accounts.recordLoginSuccess(account.accountId(), canonicalUsername);
        return issueTokens(account.accountId(), account.role(), canonicalUsername);
    }

    /**
     * Renew a session from a refresh token. The old session is revoked and a
     * single successor issued only when the presented token is unrevoked,
     * unexpired and owned by an ACTIVE account (validated server-side by the
     * database function under a token row lock, so concurrent refreshes of the
     * same token have exactly one winner); every other case fails closed to
     * AUTHENTICATION_REQUIRED.
     *
     * <p>The plaintext token passed to {@code rotate()} is the token returned
     * to the client — a second session-creating call (P1-06's hidden
     * successor) is never made, so a failed refresh cannot leave an
     * unreachable live session behind.
     */
    public IssuedSession refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        refreshToken, AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES)) {
            throw new AuthErrorException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED",
                    "A valid refresh token is required");
        }
        String newRefreshToken = RefreshTokens.generate();
        Optional<RotatedSession> rotated = sessions.rotate(
                RefreshTokens.sha256Hex(refreshToken),
                RefreshTokens.sha256Hex(newRefreshToken),
                OffsetDateTime.now().plus(refreshTtl));
        if (rotated.isEmpty() || !STATUS_ACTIVE.equals(rotated.get().status())) {
            // Unknown / revoked / expired / DISABLED account: one surface.
            throw new AuthErrorException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED",
                    "The refresh session is no longer valid");
        }
        RotatedSession session = rotated.get();
        String canonicalUsername = normalizeUsername(session.username());
        String accessToken = jwt.issueAccessToken(session.accountId(), session.role(), canonicalUsername);
        return new IssuedSession(
                new AuthResponse(
                        accessToken,
                        "Bearer",
                        jwt.accessTtl().getSeconds(),
                        Long.toString(session.accountId()),
                        session.role()),
                newRefreshToken);
    }

    /**
     * Revoke the presented refresh session for the authenticated caller.
     * Idempotent by contract: a second logout, or a foreign/unknown token, is
     * still reported as success so existence is never disclosed.
     */
    public LogoutResponse logout(long accountId, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        refreshToken, AuthInputLimits.MAX_REFRESH_TOKEN_UTF8_BYTES)) {
            throw new AuthErrorException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED",
                    "A refresh token is required");
        }
        sessions.logout(accountId, RefreshTokens.sha256Hex(refreshToken));
        return new LogoutResponse(true);
    }

    /**
     * ADMIN-only account creation (no public registration). The principal's
     * role comes from the verified access token; the database function
     * re-verifies the caller is an ACTIVE ADMIN before inserting.
     */
    public AccountResponse createAccount(JwtTokenService.Principal principal, CreateAccountRequest request) {
        if (principal == null || !ROLE_ADMIN.equals(principal.role())) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "ADMIN role is required");
        }
        if (request == null) {
            throw invalidRequestError();
        }
        String rawUsername = request.username();
        String password = request.password();
        String rawDisplayName = request.displayName();
        validateAccountInput(rawUsername, password, request.role(), rawDisplayName);
        String username = normalizeUsername(rawUsername);
        String displayName = normalizeDisplayName(rawDisplayName);
        String role = normalizeRole(request.role());
        validateNormalizedInput(username, displayName, role);
        long accountId;
        try {
            accountId = accounts.createAccount(
                    principal.accountId(),
                    username,
                    passwordEncoder.encode(password),
                    role,
                    displayName);
        } catch (DataAccessException e) {
            // Duplicate username, DB-enforced ADMIN re-check failure or any other
            // persistence failure: one generic, non-disclosing surface.
            throw genericError();
        }
        return new AccountResponse(Long.toString(accountId), username, role, STATUS_ACTIVE);
    }

    /**
     * ADMIN-ACCTS (V31): the account registry for the management UI. The
     * principal's role comes from the verified access token; the SD function
     * re-verifies the caller is an ACTIVE ADMIN before returning rows.
     */
    public List<AuthResponses.AccountListItem> listAccounts(JwtTokenService.Principal principal) {
        if (principal == null || !ROLE_ADMIN.equals(principal.role())) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "ADMIN role is required");
        }
        try {
            return accounts.listAccounts(principal.accountId()).stream()
                    .map(record -> new AuthResponses.AccountListItem(
                            Long.toString(record.accountId()),
                            record.username(),
                            record.role(),
                            record.status(),
                            record.displayName(),
                            record.createdAt() == null ? null : record.createdAt().toString()))
                    .toList();
        } catch (DataAccessException e) {
            // Persistence failure or DB-enforced ADMIN re-check failure: one
            // generic, non-disclosing surface.
            throw genericError();
        }
    }

    /**
     * ADMIN-ACCTS (V31): flip one account to DISABLED. Self-disable and
     * non-ADMIN callers fail closed inside the SD function; the response only
     * reflects a confirmed disable.
     */
    public AuthResponses.DisableAccountResponse disableAccount(
            JwtTokenService.Principal principal, long targetAccountId) {
        if (principal == null || !ROLE_ADMIN.equals(principal.role())) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "ADMIN role is required");
        }
        if (targetAccountId <= 0) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A valid target account id is required");
        }
        try {
            boolean disabled = accounts.disableAccount(principal.accountId(), targetAccountId);
            if (!disabled) {
                throw genericError();
            }
        } catch (DataAccessException e) {
            throw genericError();
        }
        return new AuthResponses.DisableAccountResponse(
                Long.toString(targetAccountId), "DISABLED");
    }

    /**
     * ACCT-DELETE (V43): delete the caller's own account (FR-AUTH-004). The
     * SD function only deletes an ACTIVE account and cascades the vc_user
     * root, so refresh sessions and all business data disappear while the
     * append-only compliance audit trail keeps the ACCOUNT_DELETE event. An
     * absent, already-deleted or disabled account maps to the generic
     * non-disclosing error.
     */
    public AuthResponses.AccountDeletedResponse deleteAccount(long accountId) {
        if (accountId <= 0) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A valid account id is required");
        }
        try {
            boolean deleted = accounts.deleteAccount(accountId);
            if (!deleted) {
                throw genericError();
            }
        } catch (DataAccessException e) {
            throw genericError();
        }
        return new AuthResponses.AccountDeletedResponse(true);
    }

    /**
     * ADMIN-OPS (V36): keyset page of the append-only audit trail, newest
     * first. ADMIN-only in the application layer and re-verified in SQL.
     */
    public List<com.virtualcompanion.platform.persistence.AuditEventRecord> listAuditEvents(
            JwtTokenService.Principal principal, Long after, int limit) {
        requireAdmin(principal);
        try {
            return adminConsole.listAuditEvents(principal.accountId(), after, limit);
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /**
     * SAFETY-QUEUE (V59): keyset page of the deterministic safety queue
     * across all owners, newest first. ADMIN-only in the application layer
     * and re-verified in SQL; read-only (triage stays human).
     */
    public List<com.virtualcompanion.platform.persistence.AdminConsoleService.SafetyEventListRecord>
            listSafetyEvents(JwtTokenService.Principal principal, Long after, int limit) {
        requireAdmin(principal);
        try {
            return adminConsole.listSafetyEvents(principal.accountId(), after, limit);
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /**
     * INVITE (V60): ADMIN mints a single-use invite code (14-day default
     * expiry). The code is generated here with a CSPRNG; the SD validates
     * shape and expiry and re-verifies the ACTIVE ADMIN.
     */
    public InviteCreated createInviteCode(JwtTokenService.Principal principal) {
        requireAdmin(principal);
        String alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        java.security.SecureRandom random = new java.security.SecureRandom();
        StringBuilder code = new StringBuilder(20);
        for (int i = 0; i < 20; i++) {
            code.append(alphabet.charAt(random.nextInt(alphabet.length())));
        }
        java.time.Instant expiresAt = java.time.Instant.now().plus(java.time.Duration.ofDays(14));
        long id;
        try {
            id = inviteCodes.create(principal.accountId(), code.toString(), expiresAt);
        } catch (DataAccessException e) {
            throw genericError();
        }
        return new InviteCreated(Long.toString(id), code.toString(), expiresAt);
    }

    /** INVITE (V60): ADMIN registry read, newest first. */
    public java.util.List<InviteCodeService.InviteCodeRecord> listInviteCodes(
            JwtTokenService.Principal principal) {
        requireAdmin(principal);
        try {
            return inviteCodes.list(principal.accountId());
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /** INVITE (V60): ADMIN retires an ACTIVE code (idempotent). */
    public boolean disableInviteCode(JwtTokenService.Principal principal, String code) {
        requireAdmin(principal);
        if (code == null || code.isBlank()) {
            throw invalidRequestError();
        }
        try {
            return inviteCodes.disable(principal.accountId(), code.trim());
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /**
     * INVITE (V60): anonymous provisioning through a valid code. Same input
     * policy as admin provisioning (the role is always USER) and the same
     * non-disclosing persistence surface; the code, not an admin, vouches
     * for the caller.
     */
    public AccountResponse inviteRegister(String code, String username, String password,
            String displayName) {
        if (code == null || code.isBlank()) {
            throw invalidRequestError();
        }
        validateAccountInput(username, password, "USER", displayName);
        String normalizedUsername = normalizeUsername(username);
        String normalizedDisplayName = normalizeDisplayName(displayName);
        validateNormalizedInput(normalizedUsername, normalizedDisplayName, "USER");
        long accountId;
        try {
            accountId = inviteCodes.redeem(
                    code.trim(), normalizedUsername, passwordEncoder.encode(password),
                    normalizedDisplayName);
        } catch (DataAccessException e) {
            // Invalid/expired/used code, duplicate username, capacity or any
            // other persistence failure: one generic, non-disclosing surface.
            throw genericError();
        }
        return new AccountResponse(Long.toString(accountId), normalizedUsername, "USER",
                STATUS_ACTIVE);
    }

    /** INVITE (V60): a freshly minted invite code. */
    public record InviteCreated(String id, String code, java.time.Instant expiresAt) {
    }

    /**
     * ADMIN-OPS (V36): per-day usage/cost summary over the window. ADMIN-only
     * in the application layer and re-verified in SQL.
     */
    public List<com.virtualcompanion.platform.persistence.UsageSummaryRecord> usageSummary(
            JwtTokenService.Principal principal, int days) {
        requireAdmin(principal);
        try {
            return adminConsole.usageSummary(principal.accountId(), days);
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /**
     * ENT-SNAP (V40): ADMIN-only simulated service-class assignment. The
     * assignment takes effect for the NEXT generation turn; already-minted
     * snapshots keep their frozen class (FR-ENT-004).
     */
    public boolean assignServiceClass(
            JwtTokenService.Principal principal, long targetAccountId, String serviceClass) {
        requireAdmin(principal);
        if (targetAccountId <= 0) {
            throw new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                    "A valid target account id is required");
        }
        // ENT-SNAP: fail closed on unapproved class codes before any call.
        String normalized = EntitlementSnapshotService.normalizeServiceClass(serviceClass);
        try {
            return entitlementSnapshotService.assign(
                    principal.accountId(), targetAccountId, normalized);
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /** ENT-SNAP (V40): ADMIN-only assignment registry read. */
    public List<EntitlementSnapshotService.ServiceClassAssignment> listServiceClassAssignments(
            JwtTokenService.Principal principal) {
        requireAdmin(principal);
        try {
            return entitlementSnapshotService.listAssignments(principal.accountId());
        } catch (DataAccessException e) {
            throw genericError();
        }
    }

    /** ADMIN-only guard shared by every management read/write. */
    private void requireAdmin(JwtTokenService.Principal principal) {
        if (principal == null || !ROLE_ADMIN.equals(principal.role())) {
            throw new AuthErrorException(HttpStatus.FORBIDDEN, "ACCESS_DENIED",
                    "ADMIN role is required");
        }
    }

    /** Platform bootstrap: seed the single ADMIN (idempotent, no-op when one exists). */
    public long seedAdmin(String username, String password, String displayName) {
        String canonicalUsername = username == null ? null : normalizeUsername(username);
        String canonicalDisplayName = normalizeDisplayName(displayName);
        if (canonicalUsername == null || canonicalUsername.isBlank()
                || password == null || password.isBlank()
                || canonicalDisplayName == null || canonicalDisplayName.isBlank()) {
            return 0; // nothing injected -> nothing seeded
        }
        if (!AuthInputLimits.withinUtf8Bytes(
                        username, AuthInputLimits.MAX_USERNAME_UTF8_BYTES)
                || !AuthInputLimits.withinUtf8Bytes(
                        password, AuthInputLimits.MAX_PASSWORD_UTF8_BYTES)
                || !AuthInputLimits.withinUtf8Bytes(
                        displayName, AuthInputLimits.MAX_DISPLAY_NAME_UTF8_BYTES)
                || username.length() > MAX_USERNAME_LENGTH
                || password.length() > MAX_PASSWORD_LENGTH
                || displayName.length() > MAX_DISPLAY_NAME_LENGTH) {
            throw invalidRequestError();
        }
        validatePasswordPolicy(password);
        validateNormalizedInput(canonicalUsername, canonicalDisplayName, ROLE_ADMIN);
        return accounts.seedAdmin(
                canonicalUsername, passwordEncoder.encode(password), canonicalDisplayName);
    }

    private IssuedSession issueTokens(long accountId, String role, String username) {
        String refreshToken = RefreshTokens.generate();
        sessions.issue(accountId, RefreshTokens.sha256Hex(refreshToken), OffsetDateTime.now().plus(refreshTtl));
        String accessToken = jwt.issueAccessToken(accountId, role, username);
        return new IssuedSession(
                new AuthResponse(
                        accessToken,
                        "Bearer",
                        jwt.accessTtl().getSeconds(),
                        Long.toString(accountId),
                        role),
                refreshToken);
    }

    /** Refresh-session TTL in seconds (used for the vc_refresh cookie Max-Age). */
    public long refreshTtlSeconds() {
        return refreshTtl.getSeconds();
    }

    private static String normalizeRole(String role) {
        if (role == null) {
            return "USER";
        }
        if (role.isBlank() || role.length() > MAX_ROLE_LENGTH) {
            throw invalidRequestError();
        }
        String normalized = role.toUpperCase(Locale.ROOT);
        if (normalized.equals(ROLE_ADMIN) || normalized.equals("USER")) {
            return normalized;
        }
        throw invalidRequestError();
    }

    private static void validateLoginInput(String username, String password) {
        if (username == null || username.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        username, AuthInputLimits.MAX_USERNAME_UTF8_BYTES)
                || username.length() > MAX_USERNAME_LENGTH
                || password == null || password.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        password, AuthInputLimits.MAX_PASSWORD_UTF8_BYTES)
                || password.length() > MAX_PASSWORD_LENGTH) {
            throw invalidRequestError();
        }
    }

    private static void validateAccountInput(
            String username, String password, String role, String displayName) {
        if (username == null || username.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        username, AuthInputLimits.MAX_USERNAME_UTF8_BYTES)
                || username.length() > MAX_USERNAME_LENGTH
                || password == null || password.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        password, AuthInputLimits.MAX_PASSWORD_UTF8_BYTES)
                || password.length() > MAX_PASSWORD_LENGTH
                || !AuthInputLimits.withinUtf8Bytes(role, AuthInputLimits.MAX_ROLE_UTF8_BYTES)
                || role != null && role.length() > MAX_ROLE_LENGTH
                || displayName == null || displayName.isBlank()
                || !AuthInputLimits.withinUtf8Bytes(
                        displayName, AuthInputLimits.MAX_DISPLAY_NAME_UTF8_BYTES)
                || displayName.length() > MAX_DISPLAY_NAME_LENGTH) {
            throw invalidRequestError();
        }
        validatePasswordPolicy(password);
    }

    /**
     * P2-03 password minimum policy (Owner 2026-08-12): a password set at account
     * creation or admin bootstrap must be at least {@value MIN_PASSWORD_LENGTH}
     * characters and contain all four character classes — uppercase, lowercase,
     * digit, and symbol (any non-letter non-digit character). A violation maps to
     * the same non-disclosing {@code INVALID_REQUEST} as every other input failure;
     * the missing class is never named, so the policy cannot be probed for an
     * enumeration side channel. Login does not call this — it authenticates an
     * existing account and never re-validates password strength.
     */
    private static void validatePasswordPolicy(String password) {
        if (password.length() < MIN_PASSWORD_LENGTH) {
            throw invalidRequestError();
        }
        boolean uppercase = false;
        boolean lowercase = false;
        boolean digit = false;
        boolean symbol = false;
        for (int i = 0; i < password.length(); i++) {
            char c = password.charAt(i);
            if (Character.isUpperCase(c)) {
                uppercase = true;
            } else if (Character.isLowerCase(c)) {
                lowercase = true;
            } else if (Character.isDigit(c)) {
                digit = true;
            } else {
                symbol = true;
            }
        }
        if (!(uppercase && lowercase && digit && symbol)) {
            throw invalidRequestError();
        }
    }

    private static void validateNormalizedInput(String username, String displayName, String role) {
        if (!AuthInputLimits.withinUtf8Bytes(username, AuthInputLimits.MAX_USERNAME_UTF8_BYTES)
                || !AuthInputLimits.withinUtf8Bytes(
                        displayName, AuthInputLimits.MAX_DISPLAY_NAME_UTF8_BYTES)
                || !AuthInputLimits.withinUtf8Bytes(role, AuthInputLimits.MAX_ROLE_UTF8_BYTES)) {
            throw invalidRequestError();
        }
    }

    static String normalizeUsername(String username) {
        return username == null ? null : username.trim().toLowerCase(Locale.ROOT);
    }

    private static String normalizeDisplayName(String displayName) {
        return displayName == null ? null : displayName.trim();
    }

    private static AuthErrorException credentialsError() {
        return new AuthErrorException(HttpStatus.NOT_FOUND, "NOT_FOUND_OR_FORBIDDEN",
                "Invalid username or password");
    }

    private static AuthErrorException disabledError() {
        return new AuthErrorException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED",
                "Account is disabled");
    }

    private static AuthErrorException genericError() {
        return new AuthErrorException(HttpStatus.NOT_FOUND, "NOT_FOUND_OR_FORBIDDEN",
                "The request could not be completed");
    }

    private static AuthErrorException invalidRequestError() {
        return new AuthErrorException(HttpStatus.BAD_REQUEST, "INVALID_REQUEST",
                "The request is invalid");
    }
}
