package com.virtualcompanion.modelruntime.contract;

/**
 * Minimal provider-neutral completion reason vocabulary.
 *
 * <p>It is internal to the adapter port and is not a persisted Catalog.</p>
 */
public enum StopReason {
    STOP,
    LENGTH,
    POLICY,
    UNKNOWN
}
