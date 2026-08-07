package com.virtualcompanion.modelruntime.routing;

/**
 * Failure or no-capacity scenario handled by {@link GenerationRecovery}.
 *
 * <p>Each scenario maps to exactly one {@link RecoveryTerminal} and one
 * {@link QuotaDisposition}, so a recovery decision is always unambiguous.
 */
public enum RecoveryScenario {
    /** A provider attempt timed out; the reserved quota is released (no useful output). */
    TIMEOUT,
    /** The user cancelled the generation; the reserved quota is released. */
    CANCELLED,
    /** No eligible deployment / no capacity was reserved; nothing to release. */
    NO_CAPACITY,
    /** Every provider attempt failed; the reserved quota is released and a deterministic safety response is emitted. */
    ALL_FAILURE
}
