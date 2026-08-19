package com.virtualcompanion.platform.persistence;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Invite-code provisioning over the V60 SD functions (INVITE, §7.4 邀请码和
 * 测试协议).
 *
 * <p>ADMIN mints single-use codes; an anonymous visitor redeems one to open
 * their own ACTIVE USER test account. Every admin function re-verifies the
 * ACTIVE ADMIN inside the SD; the redemption is atomic (code flips to USED
 * with the account insert) and shares the maxEnabledAccounts=30 capacity
 * gate and the ACCOUNT_CREATE audit with direct provisioning. Runtime
 * redemption is config-gated (invite-registration-enabled, default false).
 */
public class InviteCodeService {

    /** One registry row (list read). */
    public record InviteCodeRecord(
            long id, String code, String status, Instant createdAt,
            Instant usedAt, Instant expiresAt, Long usedByAccount) {
    }

    private final JdbcTemplate jdbc;

    public InviteCodeService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** ADMIN mints one code; returns the new row id. */
    public long create(long adminAccountId, String code, Instant expiresAt) {
        if (adminAccountId <= 0) {
            throw new IllegalArgumentException("adminAccountId must be positive");
        }
        if (code == null || !code.matches("^[A-Z0-9][A-Z0-9-]*$") || code.length() < 8
                || code.length() > 64) {
            throw new IllegalArgumentException(
                    "code must be 8..64 upper-case alphanumeric/dash characters");
        }
        Objects.requireNonNull(expiresAt, "expiresAt must not be null");
        Long id = jdbc.queryForObject(
                "SELECT vc.create_invite_code(?, ?, ?)",
                Long.class,
                adminAccountId,
                code,
                Timestamp.from(expiresAt));
        if (id == null || id <= 0) {
            throw new IllegalStateException("create_invite_code returned no id");
        }
        return id;
    }

    /** ADMIN registry read, newest first. */
    public List<InviteCodeRecord> list(long adminAccountId) {
        if (adminAccountId <= 0) {
            throw new IllegalArgumentException("adminAccountId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_code, out_status, out_created_at, out_used_at, "
                        + "out_expires_at, out_used_by_account FROM vc.list_invite_codes(?, ?)",
                (rs, rowNum) -> new InviteCodeRecord(
                        rs.getLong("out_id"),
                        rs.getString("out_code"),
                        rs.getString("out_status"),
                        rs.getTimestamp("out_created_at").toInstant(),
                        rs.getTimestamp("out_used_at") == null
                                ? null : rs.getTimestamp("out_used_at").toInstant(),
                        rs.getTimestamp("out_expires_at").toInstant(),
                        (Long) rs.getObject("out_used_by_account")),
                adminAccountId,
                50);
    }

    /** ADMIN retires a code (idempotent TRUE; absent code returns false). */
    public boolean disable(long adminAccountId, String code) {
        if (adminAccountId <= 0) {
            throw new IllegalArgumentException("adminAccountId must be positive");
        }
        Boolean disabled = jdbc.queryForObject(
                "SELECT vc.disable_invite_code(?, ?)",
                Boolean.class,
                adminAccountId,
                code);
        return Boolean.TRUE.equals(disabled);
    }

    /**
     * Anonymous redemption through a valid ACTIVE code; returns the new
     * account id. An invalid/expired/used/disabled code surfaces as a
     * DataAccessException whose message the runtime maps to one uniform
     * non-disclosing error (existence of codes is never disclosed).
     */
    public long redeem(String code, String username, String passwordHash, String displayName) {
        Long accountId = jdbc.queryForObject(
                "SELECT vc.redeem_invite_code(?, ?, ?, ?)",
                Long.class,
                code == null ? "" : code.trim(),
                username,
                passwordHash,
                displayName);
        if (accountId == null || accountId <= 0) {
            throw new IllegalStateException("redeem_invite_code returned no id");
        }
        return accountId;
    }
}
