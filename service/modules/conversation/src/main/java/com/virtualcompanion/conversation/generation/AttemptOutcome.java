package com.virtualcompanion.conversation.generation;

/**
 * In-memory outcome of one bound attempt reduction.
 *
 * <p>This value is neither a persisted provider-attempt status nor a routing,
 * retry or finalization decision.</p>
 */
public enum AttemptOutcome {
    OPEN,
    SUCCEEDED,
    FAILED,
    CANCELLED,
    INVALID_STREAM
}
