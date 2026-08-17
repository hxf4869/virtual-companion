package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Versioned consent persistence over the V41 SD functions (FR-AUTH-003).
 *
 * <p>Records are append-only (the history is never rewritten); {@link #list}
 * returns the effective latest row per type. All access is owner-scoped and
 * re-verified in SQL (V17 trusted-owner pattern). Withdrawing MODEL_TRAINING
 * never affects basic chat — the consent layer is the user-facing record
 * surface; the execution-time authorization re-check stays in the existing
 * authorization snapshot machinery (FR-AUTH-005). A revocation additionally
 * withdraws every ACTIVE authorization snapshot of the owner in the same
 * transaction (V46, AUTH-RECHECK), so queued work cannot reuse stale
 * authorization for outbound provider calls.
 */
public class ConsentService {

    /** FR-AUTH-003 consent-type catalogue (mirrors the V41 CHECK). */
    private static final Set<String> APPROVED_TYPES = Set.of(
            "SERVICE_TERMS", "PRIVACY_POLICY", "AI_CONTENT_NOTICE",
            "THIRD_PARTY_MODEL_PROCESSING", "SENSITIVE_DATA_PROCESSING",
            "EMERGENCY_CONTACT", "MODEL_TRAINING", "PUSH_NOTIFICATION");

    public static final int MAX_VERSION_LENGTH = 64;

    private final JdbcTemplate jdbc;

    public ConsentService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** FR-AUTH-003: narrow a caller-supplied consent type (fail closed). */
    public static String normalizeConsentType(String consentType) {
        if (consentType == null || consentType.isBlank()) {
            throw new IllegalArgumentException("consentType must not be blank");
        }
        if (!APPROVED_TYPES.contains(consentType)) {
            throw new IllegalArgumentException(
                    "consentType is not an approved FR-AUTH-003 type: " + consentType);
        }
        return consentType;
    }

    /** Append a versioned grant/revoke row; returns the new record id. */
    public long record(
            long ownerUserId, String consentType, String version, boolean granted) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        String normalizedType = normalizeConsentType(consentType);
        if (version == null || version.isBlank() || version.length() > MAX_VERSION_LENGTH) {
            throw new IllegalArgumentException(
                    "version must be 1.." + MAX_VERSION_LENGTH + " characters");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.record_consent(?, ?, ?, ?)",
                Long.class,
                ownerUserId,
                normalizedType,
                version.trim(),
                granted);
        if (id == null || id <= 0) {
            throw new IllegalStateException("record_consent returned no id");
        }
        // AUTH-RECHECK (FR-AUTH-005): a withdrawal must stop queued work from
        // using the old authorization — every ACTIVE snapshot of the owner is
        // flipped to WITHDRAWN in the SAME transaction, so the
        // ExecutionAuthorizationGuard refuses it before any outbound transfer.
        // The revoke row and the withdrawal commit or roll back together.
        if (!granted) {
            Integer withdrawn = jdbc.queryForObject(
                    "SELECT vc.withdraw_authorization_snapshots(?)",
                    Integer.class,
                    ownerUserId);
            if (withdrawn == null) {
                throw new IllegalStateException(
                        "withdraw_authorization_snapshots returned no count");
            }
        }
        return id;
    }

    /** The effective consent state: the latest row per type. */
    public List<ConsentRecord> list(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.query(
                "SELECT out_id, out_consent_type, out_version, out_granted, "
                        + "out_granted_at, out_revoked_at "
                        + "FROM vc.list_consents(?)",
                rowMapper(),
                ownerUserId);
    }

    /** Read the appended row back (used for the PUT response). */
    public Optional<ConsentRecord> findLatestByType(long ownerUserId, String consentType) {
        return list(ownerUserId).stream()
                .filter(record -> record.consentType().equals(consentType))
                .findFirst();
    }

    private static RowMapper<ConsentRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new ConsentRecord(
                rs.getLong("out_id"),
                rs.getString("out_consent_type"),
                rs.getString("out_version"),
                rs.getBoolean("out_granted"),
                rs.getTimestamp("out_granted_at").toInstant(),
                rs.getTimestamp("out_revoked_at") == null
                        ? null : rs.getTimestamp("out_revoked_at").toInstant());
    }
}
