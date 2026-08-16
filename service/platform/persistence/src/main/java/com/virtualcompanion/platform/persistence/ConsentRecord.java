package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.consent_record} row (V41, FR-AUTH-003).
 *
 * <p>Consent records are append-only and versioned: a grant or revoke appends
 * a new row, the history stays auditable, and the latest row per type is the
 * effective state. {@code revokedAt} is present only on revoke records.
 */
public record ConsentRecord(
        long id,
        String consentType,
        String version,
        boolean granted,
        Instant grantedAt,
        Instant revokedAt) {

    public ConsentRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(consentType, "consentType must not be null");
        if (consentType.isBlank()) {
            throw new IllegalArgumentException("consentType must not be blank");
        }
        Objects.requireNonNull(version, "version must not be null");
        Objects.requireNonNull(grantedAt, "grantedAt must not be null");
    }
}
