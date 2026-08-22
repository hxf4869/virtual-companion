package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.safety.DeterministicSafetyResponse;
import java.util.Objects;

/**
 * Minimal ZERO_LLM execution, quota release and failure-recovery service.
 *
 * <p>Maps a {@link RecoveryScenario} (or the ZERO_LLM completion path) to a single
 * {@link RecoveryOutcome} that:
 * <ul>
 *   <li>releases (or leaves untouched) the reserved synthetic quota with the correct
 *       disposition — TIMEOUT/CANCELLED/ALL_FAILURE release; NO_CAPACITY has no
 *       reservation to release;</li>
 *   <li>carries the original {@link OwnershipTuple} unchanged, so {@code generationId} is
 *       stable across retry, fallback or ZERO_LLM selection (INV-GEN-001);</li>
 *   <li>reaches exactly one {@link RecoveryTerminal} (no ambiguous/multi-terminal state);</li>
 *   <li>never creates a provider_attempt (ZERO_LLM and failure recovery are not external
 *       outbound attempts);</li>
 *   <li>emits the deterministic, safety-reviewed response for ZERO_LLM and ALL_FAILURE —
 *       never free text (the response is sourced from
 *       {@link DeterministicSafetyResponse#ZERO_LLM_FALLBACK}).</li>
 * </ul>
 *
 * <p>Recovery never bypasses the {@link com.virtualcompanion.modelruntime.authorization.ExecutionAuthorizationGuard}:
 * it produces no {@code ExternalAttemptBinding} and opens no adapter. A subsequent
 * execution/routing task wires the recovery outcome into the generation lifecycle.
 */
public final class GenerationRecovery {

    private final QuotaBook quotaLedger;

    public GenerationRecovery(QuotaBook quotaLedger) {
        this.quotaLedger = Objects.requireNonNull(quotaLedger, "quotaLedger must not be null");
    }

    /**
     * Recover from a failure or no-capacity scenario.
     *
     * @param ownership        the generation ownership; carried unchanged (stable generationId)
     * @param scenario         the failure/no-capacity scenario
     * @param priorReservation the quota reservation to release, or {@code null} when none
     *                         exists (e.g. NO_CAPACITY)
     */
    public RecoveryOutcome recover(
            OwnershipTuple ownership,
            RecoveryScenario scenario,
            QuotaReservation priorReservation
    ) {
        Objects.requireNonNull(ownership, "ownership must not be null");
        Objects.requireNonNull(scenario, "scenario must not be null");
        switch (scenario) {
            case TIMEOUT:
                releaseIfPresent(priorReservation);
                return RecoveryOutcome.of(
                        ownership,
                        RecoveryTerminal.RELEASED_ON_TIMEOUT,
                        QuotaDisposition.RELEASED,
                        "");
            case CANCELLED:
                releaseIfPresent(priorReservation);
                return RecoveryOutcome.of(
                        ownership,
                        RecoveryTerminal.RELEASED_ON_CANCEL,
                        QuotaDisposition.RELEASED,
                        "");
            case NO_CAPACITY:
                if (priorReservation != null) {
                    throw new IllegalArgumentException(
                            "NO_CAPACITY must not carry a prior reservation; got "
                                    + priorReservation.reservationId());
                }
                return RecoveryOutcome.of(
                        ownership,
                        RecoveryTerminal.NO_CAPACITY_TERMINAL,
                        QuotaDisposition.NONE,
                        "");
            case ALL_FAILURE:
                releaseIfPresent(priorReservation);
                return RecoveryOutcome.of(
                        ownership,
                        RecoveryTerminal.ALL_FAILURE_BLOCKED,
                        QuotaDisposition.RELEASED,
                        DeterministicSafetyResponse.ZERO_LLM_FALLBACK);
            default:
                throw new IllegalStateException("unexpected recovery scenario: " + scenario);
        }
    }

    /**
     * Complete a generation via the ZERO_LLM deterministic source.
     *
     * <p>Creates no provider_attempt, emits the safety-reviewed deterministic response, and
     * releases any prior (failed) provider reservation. ZERO_LLM itself consumes no quota.
     *
     * @param priorReservation a provider reservation to release, or {@code null} if ZERO_LLM
     *                         was selected without a prior external attempt
     */
    public RecoveryOutcome completeZeroLlm(OwnershipTuple ownership, QuotaReservation priorReservation) {
        Objects.requireNonNull(ownership, "ownership must not be null");
        releaseIfPresent(priorReservation);
        QuotaDisposition disposition = priorReservation != null
                ? QuotaDisposition.RELEASED
                : QuotaDisposition.NONE;
        return RecoveryOutcome.of(
                ownership,
                RecoveryTerminal.ZERO_LLM_COMPLETED,
                disposition,
                DeterministicSafetyResponse.ZERO_LLM_FALLBACK);
    }

    private void releaseIfPresent(QuotaReservation reservation) {
        if (reservation != null) {
            quotaLedger.release(reservation);
        }
    }
}
