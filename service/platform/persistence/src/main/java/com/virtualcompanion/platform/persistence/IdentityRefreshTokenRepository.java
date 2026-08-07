package com.virtualcompanion.platform.persistence;

import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * JDBC skeleton repository for V14 refresh sessions, bound to the
 * {@code vc.identity_refresh_token_*} SECURITY DEFINER functions.
 *
 * <p>The runtime always passes the sha256 hex hash of a refresh token, never
 * the raw token. Issue creates the first session after a successful login;
 * rotate atomically validates (unrevoked, unexpired, ACTIVE account), revokes
 * and replaces a session on refresh; logout revokes one owned session
 * idempotently. Unknown, revoked, expired or DISABLED-account tokens all fail
 * closed (empty / false), so existence and cause are never disclosed.
 */
public class IdentityRefreshTokenRepository {

    private final JdbcTemplate jdbc;

    public IdentityRefreshTokenRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Create the first refresh session for an ACTIVE account (post-login). */
    public long issue(long accountId, String tokenHash, OffsetDateTime expiresAt) {
        if (accountId <= 0) {
            throw new IllegalArgumentException("accountId must be positive");
        }
        validateTokenHash(tokenHash);
        if (expiresAt == null) {
            throw new IllegalArgumentException("expiresAt is required");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.identity_refresh_token_issue(?, ?, ?)",
                Long.class,
                accountId,
                tokenHash,
                expiresAt);
        return id == null ? 0 : id;
    }

    /**
     * Atomically renew a refresh session. Empty when the old token is unknown,
     * revoked, expired or owned by a DISABLED account; the result carries the
     * account identity for re-issuing the access token.
     */
    public Optional<RotatedSession> rotate(
            String oldTokenHash,
            String newTokenHash,
            OffsetDateTime newExpiresAt) {
        validateTokenHash(oldTokenHash);
        validateTokenHash(newTokenHash);
        if (newExpiresAt == null) {
            throw new IllegalArgumentException("newExpiresAt is required");
        }
        return jdbc.query(
                "SELECT out_account_id, out_role, out_status, out_username "
                        + "FROM vc.identity_refresh_token_rotate(?, ?, ?)",
                (rs, rowNum) -> new RotatedSession(
                        rs.getLong("out_account_id"),
                        rs.getString("out_role"),
                        rs.getString("out_status"),
                        rs.getString("out_username")),
                oldTokenHash,
                newTokenHash,
                newExpiresAt).stream().findFirst();
    }

    /**
     * Revoke one owned refresh session (idempotent). {@code false} for a
     * foreign or unknown token, which is never revoked (fail closed).
     */
    public boolean logout(long accountId, String tokenHash) {
        if (accountId <= 0) {
            throw new IllegalArgumentException("accountId must be positive");
        }
        validateTokenHash(tokenHash);
        Boolean revoked = jdbc.queryForObject(
                "SELECT vc.identity_logout(?, ?)",
                Boolean.class,
                accountId,
                tokenHash);
        return Boolean.TRUE.equals(revoked);
    }

    static void validateTokenHash(String tokenHash) {
        if (tokenHash == null || tokenHash.isBlank()) {
            throw new IllegalArgumentException("tokenHash is required");
        }
    }

    /** Account identity bound to a successfully rotated refresh session. */
    public record RotatedSession(long accountId, String role, String status, String username) {

        public RotatedSession {
            if (accountId <= 0) {
                throw new IllegalArgumentException("accountId must be positive");
            }
        }
    }
}
