package com.virtualcompanion.runtime.auth.application;

import com.virtualcompanion.platform.persistence.IdentityAccountRepository;
import com.virtualcompanion.platform.persistence.IdentityAccountRepository.AuthenticatedIdentity;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository;
import com.virtualcompanion.platform.persistence.IdentityRefreshTokenRepository.RotatedSession;
import com.virtualcompanion.runtime.auth.jwt.JwtTokenService;
import com.virtualcompanion.runtime.auth.web.AuthErrorException;
import com.virtualcompanion.runtime.auth.web.AuthRequests.CreateAccountRequest;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AccountResponse;
import com.virtualcompanion.runtime.auth.web.AuthResponses.AuthResponse;
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
 *   <li>Only the raw refresh token is returned to the client at issue time; the
 *       server stores only its sha256 hash, and passwords/tokens never reach
 *       logs, URLs or the model.</li>
 * </ul>
 */
public class AuthService {

    private static final String ROLE_ADMIN = "ADMIN";
    private static final String STATUS_ACTIVE = "ACTIVE";

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

    /** Login with username+password; issues an access token and a refresh session. */
    public AuthResponse login(String username, String password) {
        if (username == null || username.isBlank() || password == null) {
            // Blank credentials fail closed without an audit event (there is no
            // meaningful username to record, and existence is never disclosed).
            throw credentialsError();
        }
        Optional<AuthenticatedIdentity> identity = accounts.authenticate(username);
        String storedHash = identity.map(AuthenticatedIdentity::passwordHash).orElse(dummyHash);
        boolean passwordOk = passwordEncoder.matches(password, storedHash);
        if (identity.isEmpty() || !passwordOk) {
            accounts.recordLoginFailure(username);
            throw credentialsError();
        }
        AuthenticatedIdentity account = identity.get();
        if (!STATUS_ACTIVE.equals(account.status())) {
            accounts.recordLoginFailure(username);
            throw disabledError();
        }
        accounts.recordLoginSuccess(account.accountId(), username);
        return issueTokens(account.accountId(), account.role(), username);
    }

    /**
     * Renew a session from a refresh token. The old session is revoked and a new
     * one issued only when the presented token is unrevoked, unexpired and owned
     * by an ACTIVE account (validated server-side by the database function);
     * every other case fails closed to AUTHENTICATION_REQUIRED.
     */
    public AuthResponse refresh(String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
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
        return issueTokens(session.accountId(), session.role(), session.username());
    }

    /**
     * Revoke the presented refresh session for the authenticated caller.
     * Idempotent by contract: a second logout, or a foreign/unknown token, is
     * still reported as success so existence is never disclosed.
     */
    public LogoutResponse logout(long accountId, String refreshToken) {
        if (refreshToken == null || refreshToken.isBlank()) {
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
        String username = request.username();
        String password = request.password();
        String displayName = request.displayName();
        String role = normalizeRole(request.role());
        if (username == null || username.isBlank()) {
            throw genericError();
        }
        if (password == null || password.isBlank()) {
            throw genericError();
        }
        if (displayName == null || displayName.isBlank()) {
            throw genericError();
        }
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
        return new AccountResponse(Long.toString(accountId), username.toLowerCase(Locale.ROOT), role, STATUS_ACTIVE);
    }

    /** Platform bootstrap: seed the single ADMIN (idempotent, no-op when one exists). */
    public long seedAdmin(String username, String password, String displayName) {
        if (username == null || username.isBlank()
                || password == null || password.isBlank()
                || displayName == null || displayName.isBlank()) {
            return 0; // nothing injected -> nothing seeded
        }
        return accounts.seedAdmin(username, passwordEncoder.encode(password), displayName);
    }

    private AuthResponse issueTokens(long accountId, String role, String username) {
        String refreshToken = RefreshTokens.generate();
        sessions.issue(accountId, RefreshTokens.sha256Hex(refreshToken), OffsetDateTime.now().plus(refreshTtl));
        String accessToken = jwt.issueAccessToken(accountId, role, username);
        return new AuthResponse(
                accessToken,
                refreshToken,
                "Bearer",
                jwt.accessTtl().getSeconds(),
                Long.toString(accountId),
                role);
    }

    private static String normalizeRole(String role) {
        if (role == null || role.isBlank()) {
            return "USER";
        }
        String normalized = role.trim().toUpperCase(Locale.ROOT);
        if (normalized.equals(ROLE_ADMIN) || normalized.equals("USER")) {
            return normalized;
        }
        throw new AuthErrorException(HttpStatus.NOT_FOUND, "NOT_FOUND_OR_FORBIDDEN",
                "Role must be ADMIN or USER");
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
}
