package com.virtualcompanion.runtime.age.web;

import com.virtualcompanion.catalog.AgeState;
import com.virtualcompanion.platform.persistence.AgeAppealRecord;
import com.virtualcompanion.platform.persistence.AgeAppealService;
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
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
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
    private final AgeAppealService ageAppealService;
    private final AgeVerificationPort ageVerificationPort;

    public AgeController(
            AgeVerificationService ageVerificationService,
            AgeAppealService ageAppealService,
            AgeVerificationPort ageVerificationPort) {
        this.ageVerificationService = ageVerificationService;
        this.ageAppealService = ageAppealService;
        this.ageVerificationPort = ageVerificationPort;
    }

    /** The caller's effective age state (AGE_UNKNOWN when never verified). */
    @GetMapping("/age/state")
    public AgeStateResponse state(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        return toResponse(ageVerificationService.get(ownerUserId).orElse(null));
    }

    /**
     * Run the configured adult verification port. The provider result is obtained
     * and validated before any state write; the catalog-approved transition flow
     * is then appended as history. Default Technical Alpha configuration remains
     * simulated. A state that cannot reach a terminal provider verdict maps to
     * 400 INVALID_REQUEST (fail closed).
     */
    @PostMapping("/age/verification")
    public AgeStateResponse verify(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId) {
        AgeState current = currentState(ownerUserId);
        if (current == AgeState.ADULT_VERIFIED) {
            return toResponse(ageVerificationService.get(ownerUserId).orElse(null));
        }
        List<AgeState> prelude = switch (current) {
            case AGE_UNKNOWN -> List.of(
                    AgeState.ADULT_SELF_DECLARED, AgeState.ADULT_VERIFICATION_REQUIRED);
            case ADULT_SELF_DECLARED, MINOR_SUSPECTED ->
                    List.of(AgeState.ADULT_VERIFICATION_REQUIRED);
            case ADULT_VERIFICATION_REQUIRED, AGE_REVERIFY_REQUIRED -> List.of();
            default -> throw new IllegalArgumentException(
                    "the current age state cannot complete adult verification");
        };

        // Provider failure or an unsupported/ambiguous result happens before any
        // state write, so self-declaration can never masquerade as verification.
        AgeVerificationResult result = ageVerificationPort.verify(ownerUserId);
        if (result.state() != AgeState.ADULT_VERIFIED
                && result.state() != AgeState.MINOR_VERIFIED) {
            throw new IllegalStateException("age provider returned a non-terminal verification result");
        }
        List<AgeState> flow = new java.util.ArrayList<>(prelude);
        flow.add(result.state());
        AgeState previous = current;
        for (AgeState next : flow) {
            if (!AgeStateTransitions.allows(previous, next)) {
                throw new IllegalStateException(
                        "age-state transition rejected by the catalog table: "
                                + previous + " -> " + next);
            }
            previous = next;
        }
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

    /**
     * AGE-APPEAL (V56, FR-AUTH-002 申诉入口): append one appeal and flip the
     * effective state to AGE_APPEAL_PENDING in the same transaction. Only a
     * state the age-states catalog can reach AGE_APPEAL_PENDING from
     * (ADULT_VERIFICATION_REQUIRED / MINOR_SUSPECTED) may appeal; anything
     * else maps to 400 INVALID_REQUEST (fail closed). Resolution stays a
     * human review action — this endpoint never rewrites a result.
     */
    @PostMapping("/age/appeal")
    public AgeAppealResponse appeal(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestBody AgeAppealRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("request body is required");
        }
        String reason = AgeAppealService.normalizeReason(request.reason());
        AgeState current = currentState(ownerUserId);
        if (!AgeStateTransitions.allows(current, AgeState.AGE_APPEAL_PENDING)) {
            throw new IllegalArgumentException(
                    "the current age state cannot submit an appeal");
        }
        ageAppealService.submit(ownerUserId, reason);
        // The newest row of the same owner is the row just appended (ids are
        // allocated from a single monotonic sequence).
        return ageAppealService.list(ownerUserId, null, 1).stream()
                .findFirst()
                .map(AgeController::toAppealResponse)
                .orElseThrow(() -> new IllegalStateException(
                        "submitted age appeal not readable"));
    }

    /** AGE-APPEAL: the caller's appeals, newest-first keyset. */
    @GetMapping("/age/appeals")
    public List<AgeAppealResponse> appeals(
            @AuthenticationPrincipal(expression = "accountId") long ownerUserId,
            @RequestParam(name = "after", required = false) String after,
            @RequestParam(name = "limit", required = false) String limit) {
        return ageAppealService
                .list(ownerUserId, parseOptionalLong(after), parseOptionalInt(limit))
                .stream()
                .map(AgeController::toAppealResponse)
                .toList();
    }

    private static Long parseOptionalLong(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.parseLong(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("after is not a valid id: " + raw, e);
        }
    }

    private static Integer parseOptionalInt(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Integer.parseInt(raw);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("limit is not a valid number: " + raw, e);
        }
    }

    private static AgeAppealResponse toAppealResponse(AgeAppealRecord record) {
        return new AgeAppealResponse(
                Long.toString(record.id()),
                record.reason(),
                record.status(),
                record.resolutionNote().isEmpty() ? null : record.resolutionNote(),
                record.createdAt().toString(),
                record.resolvedAt() == null ? null : record.resolvedAt().toString());
    }

    /** Appeal submission body (OpenAPI {@code AgeAppealRequest}). */
    public record AgeAppealRequest(String reason) {
    }

    /** Appeal record body (OpenAPI {@code AgeAppealRecord}). */
    public record AgeAppealResponse(
            String id, String reason, String status, String resolutionNote,
            String createdAt, String resolvedAt) {
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
