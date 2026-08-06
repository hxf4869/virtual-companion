package com.virtualcompanion.generation.contract;

/**
 * The unique terminal state produced by one {@link OfflineGenerationSlice} run.
 *
 * <p>Each distinct fault class maps to a distinct state so the offline slice
 * proves that success, the normalized Failure fault matrix, cancellation, a
 * safety block and an authorization denial never collapse into one another
 * (TASK-0022 acceptance: all terminal states are unique and distinguishable).
 */
public enum SliceTerminalState {
    /** Fake adapter streamed to EOS and the final safety review allowed completion. */
    COMPLETED,
    /** The attempt succeeded at the adapter but the final safety review blocked completion. */
    BLOCKED_AT_SAFETY,
    /** The attempt was cancelled mid-stream before any terminal fault. */
    CANCELLED,
    /** The ExecutionAuthorizationGuard denied the attempt before any outbound transfer. */
    DENIED_BY_AUTHORIZATION,
    /** {@code AdapterFailure.RateLimited}. */
    FAILED_RATE_LIMITED,
    /** {@code AdapterFailure.UpstreamUnavailable}. */
    FAILED_UPSTREAM_UNAVAILABLE,
    /** {@code AdapterFailure.Timeout(CONNECT)}. */
    FAILED_TIMEOUT_CONNECT,
    /** {@code AdapterFailure.Timeout(FIRST_TOKEN)}. */
    FAILED_TIMEOUT_FIRST_TOKEN,
    /** {@code AdapterFailure.Timeout(TOTAL)}. */
    FAILED_TIMEOUT_TOTAL,
    /** {@code AdapterFailure.MalformedResponse}. */
    FAILED_MALFORMED_RESPONSE,
    /** {@code AdapterFailure.Disconnected}. */
    FAILED_DISCONNECTED,
    /** {@code AdapterFailure.CancellationFailed}. */
    FAILED_CANCELLATION_FAILED,
    /** {@code AdapterFailure.UnsupportedBinding}/{@code UnsupportedCapability} or an invalid stream. */
    FAILED_INVALID_STREAM
}
