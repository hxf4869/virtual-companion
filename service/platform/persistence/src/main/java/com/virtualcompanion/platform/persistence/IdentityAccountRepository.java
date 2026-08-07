package com.virtualcompanion.platform.persistence;

import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * JDBC skeleton repository for the V14 identity accounts, bound to the
 * {@code vc.identity_*} SECURITY DEFINER functions.
 *
 * <p>Identity tables are platform-level management objects with no direct DML
 * for any runtime role; every access flows through the SECURITY DEFINER
 * functions, which fail closed on cross-account, unauthorized, DISABLED or
 * unknown operations and never disclose existence. The BCrypt hash is opaque to
 * this module: {@link #authenticate} returns it so the runtime can run the
 * Spring Security BCrypt comparison in the JVM. Argument validation is eager
 * and side-effect free so it is unit-testable without a database; the runtime
 * behavior is proven by the SQL suite under {@code infra/db/tests}.
 */
public class IdentityAccountRepository {

    private final JdbcTemplate jdbc;

    public IdentityAccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Fetch the stored credential row for a login attempt. An unknown username
     * resolves to {@link Optional#empty()} -- existence is never disclosed. The
     * runtime equalizes timing with a dummy BCrypt hash for the unknown case.
     */
    public Optional<AuthenticatedIdentity> authenticate(String username) {
        validateUsername(username);
        return jdbc.query(
                "SELECT out_account_id, out_role, out_status, out_password_hash "
                        + "FROM vc.identity_authenticate(?)",
                (rs, rowNum) -> new AuthenticatedIdentity(
                        rs.getLong("out_account_id"),
                        rs.getString("out_role"),
                        rs.getString("out_status"),
                        rs.getString("out_password_hash")),
                username).stream().findFirst();
    }

    /**
     * ADMIN-only account creation (no public registration). The underlying
     * function fails closed when the acting account is not an ACTIVE ADMIN and
     * rejects a duplicate username via the UNIQUE constraint.
     */
    public long createAccount(
            long actingAccountId,
            String username,
            String passwordHash,
            String role,
            String displayName) {
        if (actingAccountId <= 0) {
            throw new IllegalArgumentException("actingAccountId must be positive");
        }
        validateUsername(username);
        validatePasswordHash(passwordHash);
        if (role == null || role.isBlank()) {
            throw new IllegalArgumentException("role is required");
        }
        if (displayName == null || displayName.isBlank()) {
            throw new IllegalArgumentException("displayName is required");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.identity_account_create(?, ?, ?, ?, ?)",
                Long.class,
                actingAccountId,
                username,
                passwordHash,
                role,
                displayName);
        return id == null ? 0 : id;
    }

    /**
     * Idempotent platform bootstrap: create the single ADMIN account. Returns
     * the existing ADMIN id when one already exists (restart-safe, never
     * overwrites). Credentials are injected through an approved channel and
     * never committed to the repository.
     */
    public long seedAdmin(String username, String passwordHash, String displayName) {
        validateUsername(username);
        validatePasswordHash(passwordHash);
        if (displayName == null || displayName.isBlank()) {
            throw new IllegalArgumentException("displayName is required");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.identity_admin_seed(?, ?, ?)",
                Long.class,
                username,
                passwordHash,
                displayName);
        return id == null ? 0 : id;
    }

    /** Audit a successful login for an account. */
    public void recordLoginSuccess(long accountId, String username) {
        if (accountId <= 0) {
            throw new IllegalArgumentException("accountId must be positive");
        }
        validateUsername(username);
        jdbc.update("SELECT vc.identity_login_success(?, ?)", accountId, username);
    }

    /** Audit a failed login for a username (internal account, non-sensitive). */
    public void recordLoginFailure(String username) {
        validateUsername(username);
        jdbc.update("SELECT vc.identity_login_failure(?)", username);
    }

    static void validateUsername(String username) {
        if (username == null || username.isBlank()) {
            throw new IllegalArgumentException("username is required");
        }
    }

    static void validatePasswordHash(String passwordHash) {
        if (passwordHash == null || passwordHash.isBlank()) {
            throw new IllegalArgumentException("passwordHash is required");
        }
    }

    /**
     * The credential-fetch result: account id, role, status and the stored
     * BCrypt hash. The runtime compares the presented password against the hash
     * and rejects DISABLED accounts; both failures map to the same
     * AUTHENTICATION_REQUIRED / NOT_FOUND_OR_FORBIDDEN surface (no disclosure).
     */
    public record AuthenticatedIdentity(
            long accountId,
            String role,
            String status,
            String passwordHash) {

        public AuthenticatedIdentity {
            if (accountId <= 0) {
                throw new IllegalArgumentException("accountId must be positive");
            }
            if (passwordHash == null || passwordHash.isBlank()) {
                throw new IllegalArgumentException("passwordHash is required");
            }
        }
    }
}
