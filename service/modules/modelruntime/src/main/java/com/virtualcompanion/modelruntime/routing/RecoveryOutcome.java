package com.virtualcompanion.modelruntime.routing;

import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import java.util.Objects;

/**
 * Immutable recovery decision for a failed or ZERO_LLM-completed generation.
 *
 * <p>Carries the original {@link OwnershipTuple} unchanged so the {@code generationId} is
 * stable across retry, fallback, model switch or ZERO_LLM selection (INV-GEN-001). Exactly
 * one {@link RecoveryTerminal} is set, so the outcome is never ambiguous.
 *
 * <p>A recovery decision <em>never</em> creates a provider_attempt: the
 * {@code providerAttemptCreated} flag is structurally forced to {@code false} by the
 * compact constructor, so ZERO_LLM and failure recovery cannot accidentally produce an
 * external attempt binding. This enforces the generation-contract invariant that ZERO_LLM
 * creates no provider_attempt and that failure recovery does not bypass the outbound
 * execution path.
 *
 * @param response the deterministic safety response text for ZERO_LLM / ALL_FAILURE
 *                 (empty for non-response terminals); sourced from
 *                 {@code DeterministicSafetyResponse}, never free text
 */
public record RecoveryOutcome(
        OwnershipTuple ownership,
        RecoveryTerminal terminal,
        QuotaDisposition quotaDisposition,
        String response,
        boolean providerAttemptCreated
) {

    public RecoveryOutcome {
        Objects.requireNonNull(ownership, "ownership must not be null");
        Objects.requireNonNull(terminal, "terminal must not be null");
        Objects.requireNonNull(quotaDisposition, "quotaDisposition must not be null");
        Objects.requireNonNull(response, "response must not be null");
        if (providerAttemptCreated) {
            throw new IllegalArgumentException(
                    "RecoveryOutcome must never create a provider_attempt");
        }
    }

    /**
     * Factory for a recovery decision. {@code providerAttemptCreated} is always false.
     */
    public static RecoveryOutcome of(
            OwnershipTuple ownership,
            RecoveryTerminal terminal,
            QuotaDisposition quotaDisposition,
            String response
    ) {
        return new RecoveryOutcome(ownership, terminal, quotaDisposition, response, false);
    }
}
