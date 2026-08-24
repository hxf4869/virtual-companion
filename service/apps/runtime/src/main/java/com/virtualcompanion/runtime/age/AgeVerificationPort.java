package com.virtualcompanion.runtime.age;

import com.virtualcompanion.catalog.AgeState;
import java.time.Instant;
import java.util.Objects;

/**
 * AGE-MIN (FR-AUTH-002): the age-verification PORT. Independent of any
 * provider so the caller is unchanged when the default-off real adapter is
 * enabled. Technical Alpha continues to inject {@link SimulatedAgeVerifier}
 * unless the separately approved provider configuration is complete.
 *
 * <p>The result carries the verified age band ({@link AgeState}), the
 * provider reference and the verification time — never the identity document.
 */
public interface AgeVerificationPort {

    /**
     * Verify the adult status of one owner. Implementations must be safe to
     * call for any current state; a result that would violate the age-states
     * catalog transition table is rejected by the caller before persistence.
     */
    AgeVerificationResult verify(long ownerUserId);

    /** One verification outcome (FR-AUTH-002: 结果/年龄段/时间/供应商凭证). */
    record AgeVerificationResult(AgeState state, String providerRef, Instant verifiedAt) {
        public AgeVerificationResult {
            Objects.requireNonNull(state, "state must not be null");
            Objects.requireNonNull(providerRef, "providerRef must not be null");
            if (providerRef.isBlank()) {
                throw new IllegalArgumentException("providerRef must not be blank");
            }
            Objects.requireNonNull(verifiedAt, "verifiedAt must not be null");
        }
    }
}
