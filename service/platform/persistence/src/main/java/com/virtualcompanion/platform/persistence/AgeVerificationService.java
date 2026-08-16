package com.virtualcompanion.platform.persistence;

import java.sql.ResultSet;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

/**
 * Adult-verification persistence over the V45 SD functions (AGE-MIN /
 * FR-AUTH-002). Append-only result history per owner; the latest row is the
 * effective state. Only results, times and provider references are stored —
 * never identity documents. Every call re-verifies the trusted-owner context
 * inside the SD (V17 pattern).
 */
public class AgeVerificationService {

    private final JdbcTemplate jdbc;

    public AgeVerificationService(JdbcTemplate jdbc) {
        this.jdbc = Objects.requireNonNull(jdbc, "jdbc must not be null");
    }

    /** Append one verification-result row; returns the new row id. */
    public long record(long ownerUserId, String ageState, String providerRef) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        if (ageState == null || ageState.isBlank()) {
            throw new IllegalArgumentException("ageState must not be blank");
        }
        if (providerRef == null || providerRef.isBlank()) {
            throw new IllegalArgumentException("providerRef must not be blank");
        }
        Long id = jdbc.queryForObject(
                "SELECT vc.record_age_verification(?, ?, ?)",
                Long.class,
                ownerUserId,
                ageState,
                providerRef);
        if (id == null || id <= 0) {
            throw new IllegalStateException("record_age_verification returned no id");
        }
        return id;
    }

    /** The effective (latest) age-verification row; empty when never verified. */
    public Optional<AgeVerificationRecord> get(long ownerUserId) {
        if (ownerUserId <= 0) {
            throw new IllegalArgumentException("ownerUserId must be positive");
        }
        return jdbc.query(
                        "SELECT out_id, out_age_state, out_provider_ref, out_verified_at "
                                + "FROM vc.get_age_state(?)",
                        rowMapper(),
                        ownerUserId)
                .stream()
                .findFirst();
    }

    private static RowMapper<AgeVerificationRecord> rowMapper() {
        return (ResultSet rs, int rowNum) -> new AgeVerificationRecord(
                rs.getLong("out_id"),
                rs.getString("out_age_state"),
                rs.getString("out_provider_ref"),
                rs.getTimestamp("out_verified_at").toInstant());
    }
}
