package com.virtualcompanion.modelruntime.routing;

/**
 * Quota effect of a recovery decision.
 *
 * <p>{@code RELEASED} restores a previously reserved budget (failure / cancel / ZERO_LLM
 * release of a failed provider reservation). {@code NONE} means no reservation existed to
 * release (NO_CAPACITY, or ZERO_LLM with no prior reservation — ZERO_LLM itself is free).
 *
 * <p>Consumption-on-success ({@code SETTLED}) is the finalization path (TASK-0018
 * {@code finalize_generation}) and is intentionally out of scope for failure recovery: a
 * failed or ZERO_LLM-completed generation never charges synthetic quota for a provider
 * attempt, because none succeeded.
 */
public enum QuotaDisposition {
    RELEASED,
    NONE
}
