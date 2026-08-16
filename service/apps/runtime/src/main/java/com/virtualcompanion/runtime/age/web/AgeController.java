package com.virtualcompanion.runtime.age.web;

import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.platform.persistence.AgeVerificationRecord;
import com.virtualcompanion.platform.persistence.AgeVerificationService;
import com.virtualcompanion.runtime.age.AgeStateTransitions;
import com.virtualcompanion.runtime.age.AgeVerificationPort;
import com.virtualcompanion.runtime.age.AgeVerificationPort.AgeVerificationResult;
import com.virtualcompanion.runtime.age.SimulatedAgeVerifier;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Adult-verification HTTP API (AGE-MIN / FR-AUTH-002). Beta gate dependent:
 * product-scope requires {@code ADULT_VERIFIED} before generative chat opens
 * to real users. Technical Alpha exposes the state read and a verification
 * write through the simulated port ({@link SimulatedAgeVerifier}) — the
 * vendor-agnostic {@link AgeVerificationPort} seam is what a real provider
 * will implement; no identity document is ever stored, only the result, the
 * age band, the time and the provider reference.
 *
 * <p>{@code GET /api/v1/age/state} returns the effective state (AGE_UNKNOWN
 * when never verified). {@code POST /api/v1/age/verification} walks the
 * catalog-approved flow to ADULT_VERIFIED (append-only history) or fails
 * closed with 400 INVALID_REQUEST when the current state cannot reach
 * ADULT_VERIFIED (minor / appeal / suspended). Every transition is checked
 * against the age-states catalog transition table.
 *
 * <p>Authenticated: the principal's account id is the owner id; the owner GUC
 * is bound upstream by the owner-injection filter.
 */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(
        name = "virtual-companion.auth.datasource-enabled",
        havingValue = "true")
public class AgeController {

    private final AgeVerificationService ageVerificationService;
    private final AgeVerificationPort ageVerificationPort;
    private final SimulatedAgeVerifier simulatedAgeVerifier;

    public AgeController(
            AgeVerificationService ageVerificationService,
            AgeVerificationPort ageVerificationPort,
            SimulatedAgeVerifier simulatedAgeVerifier) {
        this.ageVerificationService = ageVerificationService;
        this.ageVerificationPort = ageVerificationPort;
        this.simulatedAgeVerifier = simulatedAgeVerifier;
    }

    /** The caller's effective age state (AGE_UNKNOWN when never verified). */
    @GetMapping("/age/state")
    public AgeStateResponse state(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return toResponse(ageVerificationService.get(ownerUserId).orElse(null));
    }

    /**
     * Run the simulated adult verification. The current state is resolved
     * (AGE_UNKNOWN default), the port flow is walked with every transition
     * checked against the catalog table, and each step is appended to the
     * result history. A state that cannot reach ADULT_VERIFIED maps to
     * 400 INVALID_REQUEST (fail closed).
     */
    @PostMapping("/age/verification")
    public AgeStateResponse verify(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        AgeState current = currentState(ownerUserId);
        List<AgeState> flow = simulatedAgeVerifier.flowFor(current);
        if (flow.isEmpty()) {
            // Already verified: idempotent success without a new write.
            if (current == AgeState.ADULT_VERIFIED) {
                return toResponse(ageVerificationService.get(ownerUserId).orElse(null));
            }
            // Minor / appeal / suspended: the catalog forbids reaching
            // ADULT_VERIFIED — fail closed.
            throw new IllegalArgumentException(
                    "the current age state cannot complete adult verification");
        }
        AgeState previous = current;
        for (AgeState next : flow) {
            if (!AgeStateTransitions.allows(previous, next)) {
                throw new IllegalStateException(
                        "age-state transition rejected by the catalog table: "
                                + previous + " -> " + next);
            }
            previous = next;
        }
        AgeVerificationResult result = ageVerificationPort.verify(ownerUserId);
        // Persist every flow step with the same provider reference (append-only
        // history; the latest row is the effective state).
        for (AgeState step : flow) {
            ageVerificationService.record(
                    ownerUserId, step.code(), result.providerRef());
        }
        return toResponse(ageVerificationService.get(ownerUserId).orElse(null));
    }

    private AgeState currentState(long ownerUserId) {
        return ageVerificationService
                .get(ownerUserId)
                .map(AgeVerificationRecord::ageState)
                .map(AgeState::valueOf)
                .orElse(AgeState.AGE_UNKNOWN);
    }

    private static AgeStateResponse toResponse(AgeVerificationRecord record) {
        if (record == null) {
            return new AgeStateResponse(AgeState.AGE_UNKNOWN.code(), null, null);
        }
        return new AgeStateResponse(
                record.ageState(),
                record.providerRef(),
                record.verifiedAt().toString());
    }

    /** Status body (OpenAPI {@code AgeStateResponse}). */
    public record AgeStateResponse(
            String ageState, String providerRef, String verifiedAt) {

        public AgeStateResponse {
            if (ageState == null || ageState.isBlank()) {
                throw new IllegalArgumentException("ageState must not be blank");
            }
        }
    }
}
