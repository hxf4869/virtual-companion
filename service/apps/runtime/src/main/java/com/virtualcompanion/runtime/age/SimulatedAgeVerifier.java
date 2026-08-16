package com.virtualcompanion.runtime.age;

import com.virtualcompanion.catalog.AgeState;
import java.time.Instant;
import java.util.List;

/**
 * AGE-MIN (FR-AUTH-002): the Technical Alpha simulated age verifier. The
 * product must never ship a bare "我已成年" checkbox as the final gate, but
 * Alpha has no verification vendor — this deterministic implementation plays
 * the port seam: it walks the catalog-approved path
 * {@code AGE_UNKNOWN -> ADULT_SELF_DECLARED -> ADULT_VERIFICATION_REQUIRED ->
 * ADULT_VERIFIED} for any currently unverified state and resolves to
 * {@code ADULT_VERIFIED} with the {@code alpha-simulated} provider reference.
 * States that the catalog forbids from reaching ADULT_VERIFIED (minor,
 * appeal-pending, suspended) are left untouched by the verifier.
 */
public class SimulatedAgeVerifier implements AgeVerificationPort {

    /** Provider reference recorded with every simulated result. */
    public static final String PROVIDER_ALPHA_SIMULATED = "alpha-simulated";

    @Override
    public AgeVerificationResult verify(long ownerUserId) {
        return new AgeVerificationResult(
                AgeState.ADULT_VERIFIED, PROVIDER_ALPHA_SIMULATED, Instant.now());
    }

    /**
     * The verification flow the controller records: for a state that can
     * still reach ADULT_VERIFIED the flow appends the declaration and
     * verification-required markers (history) before sealing ADULT_VERIFIED;
     * for minor/appeal/suspended states it returns the current state with no
     * write (the caller then fails closed).
     *
     * @return the states to append in order, or an empty list when the
     *     current state cannot reach ADULT_VERIFIED
     */
    public List<AgeState> flowFor(AgeState current) {
        if (current == null) {
            return List.of(
                    AgeState.ADULT_SELF_DECLARED,
                    AgeState.ADULT_VERIFICATION_REQUIRED,
                    AgeState.ADULT_VERIFIED);
        }
        switch (current) {
            case AGE_UNKNOWN:
                return List.of(
                        AgeState.ADULT_SELF_DECLARED,
                        AgeState.ADULT_VERIFICATION_REQUIRED,
                        AgeState.ADULT_VERIFIED);
            case ADULT_SELF_DECLARED:
                return List.of(
                        AgeState.ADULT_VERIFICATION_REQUIRED, AgeState.ADULT_VERIFIED);
            case ADULT_VERIFICATION_REQUIRED:
            case AGE_REVERIFY_REQUIRED:
                return List.of(AgeState.ADULT_VERIFIED);
            case ADULT_VERIFIED:
                return List.of();
            default:
                // MINOR_SUSPECTED / MINOR_VERIFIED / AGE_APPEAL_PENDING /
                // AGE_ACCESS_SUSPENDED: the catalog forbids reaching
                // ADULT_VERIFIED from these — no simulated write.
                return List.of();
        }
    }
}
