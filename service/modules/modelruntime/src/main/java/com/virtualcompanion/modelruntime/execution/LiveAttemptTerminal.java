package com.virtualcompanion.modelruntime.execution;

/**
 * Unique terminal outcome of one live model invocation.
 *
 * <p>Never ambiguous: a cancelled stream never reports success and a timed-out
 * attempt never fabricates a completed state (INV-GEN-003). Each invocation
 * reaches exactly one terminal.</p>
 */
public enum LiveAttemptTerminal {
    SUCCEEDED,
    FAILED,
    TIMED_OUT,
    CANCELLED,
    BLOCKED_BY_AUTHORIZATION,
    BLOCKED_BY_SAFETY,
    ZERO_LLM_COMPLETED,
    NO_ELIGIBLE_DEPLOYMENT
}
