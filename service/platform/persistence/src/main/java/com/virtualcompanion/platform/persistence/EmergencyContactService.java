package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Emergency-contact persistence over the V65 SD functions (§20.14).
 *
 * <p>The lifecycle: save (requires the standing EMERGENCY_CONTACT consent,
 * enforced in SQL) → one-time invite token (hash-only store) → contact-side
 * confirmation (binds when/how/version, 180-day validity) → lazy expiry back
 * to DRAFT; changing the contact value demotes to DRAFT; revoke is terminal.
 * Every read of a stored row appends an EMERGENCY_CONTACT_VIEW audit row in
 * the same transaction. No function ever performs an actual liaison — that
 * stays a human action outside the API.
 */
public class EmergencyContactService {

    public static final int MAX_LABEL_LENGTH = 64;

    private final JdbcTemplate jdbc;

    public EmergencyContactService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /**
     * One verification invite: the row id, the one-time token (only ever
     * surfaced here — the database stores its sha256 digest) and the invite
     * time. An Alpha invite is relayed by the caller; nothing is sent.
     */
    public record VerificationInvite(long id, String token, Instant invitedAt) {

        public VerificationInvite {
            if (id <= 0) {
                throw new IllegalArgumentException("id must be positive");
            }
            Objects.requireNonNull(token, "token must not be null");
            if (token.isBlank()) {
                throw new IllegalArgumentException("token must not be blank");
            }
            Objects.requireNonNull(invitedAt, "invitedAt must not be null");
        }
    }

    /** Save or change the contact (cipher); returns the row id. */
    public long upsert(long ownerUserId, String label, String contactCipher) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (label == null || label.isBlank() || label.length() > MAX_LABEL_LENGTH) {
            throw new IllegalArgumentException(
                    "label must be 1.." + MAX_LABEL_LENGTH + " characters");
        }
        if (contactCipher == null || contactCipher.isBlank()) {
            throw new IllegalArgumentException("contactCipher must not be blank");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.upsert_emergency_contact(?, ?, ?)",
                Long.class,
                ownerUserId,
                label.trim(),
                contactCipher);
        if (id == null || id <= 0) {
            throw new IllegalStateException("upsert_emergency_contact returned no id");
        }
        return id;
    }

    /** Mint a one-time verification invite token for the draft contact. */
    public VerificationInvite startVerification(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        List<VerificationInvite> rows = jdbc.query(
                "SELECT out_id, out_token, out_invited_at "
                        + "FROM vc.start_emergency_contact_verification(?)",
                (ResultSet rs, int rowNum) -> new VerificationInvite(
                        rs.getLong("out_id"),
                        rs.getString("out_token"),
                        rs.getTimestamp("out_invited_at").toInstant()),
                ownerUserId);
        if (rows.isEmpty()) {
            throw new IllegalStateException(
                    "start_emergency_contact_verification returned no invite");
        }
        return rows.get(0);
    }

    /** The contact-side acceptance; returns the verified row id. */
    public long confirmVerification(
            long ownerUserId, String token, String verifiedMethod, String consentVersion) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("token must not be blank");
        }
        if (verifiedMethod == null || verifiedMethod.isBlank()) {
            throw new IllegalArgumentException("verifiedMethod must not be blank");
        }
        if (consentVersion == null || consentVersion.isBlank()) {
            throw new IllegalArgumentException("consentVersion must not be blank");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.confirm_emergency_contact_verification(?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                token.trim(),
                verifiedMethod,
                consentVersion);
        if (id == null || id <= 0) {
            throw new IllegalStateException(
                    "confirm_emergency_contact_verification returned no id");
        }
        return id;
    }

    /** Withdraw the live contact; returns whether one existed. */
    public boolean revoke(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        Boolean revoked = jdbc.queryForObject(
                "SELECT vc.revoke_emergency_contact(?)",
                Boolean.class,
                ownerUserId);
        return Boolean.TRUE.equals(revoked);
    }

    /** The live (non-revoked) contact, after the lazy expiry demotion. */
    public Optional<EmergencyContactRecord> get(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        List<EmergencyContactRecord> rows = jdbc.query(
                "SELECT out_id, out_label, out_contact_cipher, out_status, "
                        + "out_consent_version, out_invited_at, out_verified_at, "
                        + "out_verified_method, out_verified_expires_at, "
                        + "out_created_at, out_updated_at "
                        + "FROM vc.get_emergency_contact(?)",
                rowMapper(),
                ownerUserId);
        return rows.stream().findFirst();
    }

    private static RowMapper<EmergencyContactRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new EmergencyContactRecord(
                rs.getLong("out_id"),
                rs.getString("out_label"),
                rs.getString("out_contact_cipher"),
                rs.getString("out_status"),
                rs.getString("out_consent_version"),
                timestamp(rs, "out_invited_at"),
                timestamp(rs, "out_verified_at"),
                rs.getString("out_verified_method"),
                timestamp(rs, "out_verified_expires_at"),
                timestamp(rs, "out_created_at"),
                timestamp(rs, "out_updated_at"));
    }

    private static Instant timestamp(ResultSet rs, String column) throws java.sql.SQLException {
        java.sql.Timestamp ts = rs.getTimestamp(column);
        return ts == null ? null : ts.toInstant();
    }
}
