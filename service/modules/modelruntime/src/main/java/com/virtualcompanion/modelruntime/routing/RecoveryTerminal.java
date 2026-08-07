package com.virtualcompanion.modelruntime.routing;

/**
 * Routing-level unique terminal reached by a recovery decision.
 *
 * <p>Each {@link RecoveryScenario} (and the ZERO_LLM completion path) maps to exactly one
 * terminal, so a recovery never leaves a generation in an ambiguous or multi-terminal
 * state. These are routing-level outcomes; the generation-lifecycle layer maps them to
 * {@code GenerationState} terminals (e.g. COMPLETED_FALLBACK, FAILED_FINAL, CANCELLED,
 * OUTPUT_BLOCKED) in a later wiring task.
 */
public enum RecoveryTerminal {
    /** ZERO_LLM completed: deterministic safety response, no provider_attempt, prior reservation released. */
    ZERO_LLM_COMPLETED,
    /** TIMEOUT: reserved quota released. */
    RELEASED_ON_TIMEOUT,
    /** CANCELLED: reserved quota released. */
    RELEASED_ON_CANCEL,
    /** NO_CAPACITY: no reservation existed, nothing released. */
    NO_CAPACITY_TERMINAL,
    /** ALL_FAILURE: reserved quota released and deterministic safety response emitted (never free text). */
    ALL_FAILURE_BLOCKED
}
