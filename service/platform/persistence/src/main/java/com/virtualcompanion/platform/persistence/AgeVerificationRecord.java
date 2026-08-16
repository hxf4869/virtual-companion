package com.virtualcompanion.platform.persistence;

import java.time.Instant;
import java.util.Objects;

/**
 * One {@code vc.age_verification} row (V45, FR-AUTH-002).
 *
 * <p>The latest row per owner is the effective age state (age-states catalog,
 * 9 codes). The record deliberately carries only the verification result,
 * the verification time and a provider reference — never the identity
 * document (需求：不保存完整身份证号码).
 */
public record AgeVerificationRecord(
        long id,
        String ageState,
        String providerRef,
        Instant verifiedAt) {

    public AgeVerificationRecord {
        if (id <= 0) {
            throw new IllegalArgumentException("id must be positive");
        }
        Objects.requireNonNull(ageState, "ageState must not be null");
        if (ageState.isBlank()) {
            throw new IllegalArgumentException("ageState must not be blank");
        }
        Objects.requireNonNull(providerRef, "providerRef must not be null");
        Objects.requireNonNull(verifiedAt, "verifiedAt must not be null");
    }
}
