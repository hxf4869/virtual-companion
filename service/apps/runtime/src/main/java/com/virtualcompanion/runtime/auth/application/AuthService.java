package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository.RotatedSession;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthErrorException;
import com.virtualcompanion.runtime.auth.web.AuthInputLimits;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.IssuedSession;
import com.virtualcompanion.runtime.auth.web.AuthResponses.LogoutResponse;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.Locale;
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

    private final IdentityAccountRepository accounts;
    private final IdentityRefreshTokenRepository sessions;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenService jwt;
    private final Duration refreshTtl;
    private final String dummyHash;

    public AuthService(
            IdentityAccountRepository accounts,
            IdentityRefreshTokenRepository sessions,
            PasswordEncoder passwordEncoder,
            JwtTokenService jwt,
            Duration refreshTtl) {
        this.accounts = accounts;
        this.sessions = sessions;
        this.passwordEncoder = passwordEncoder;
        this.jwt = jwt;
        if (refreshTtl == null || refreshTtl.isZero() || refreshTtl.isNegative()) {
            throw new IllegalArgumentException("refresh TTL must be positive");
        }
        this.refreshTtl = refreshTtl;
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
