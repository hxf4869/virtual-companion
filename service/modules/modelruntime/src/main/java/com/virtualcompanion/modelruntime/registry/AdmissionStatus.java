package com.virtualcompanion.modelruntime.registry;

/**
 * Lifecycle state of a registered provider deployment.
 * <p>
 * A deployment starts {@link #ADMITTED} when first registered. It may be
 * moved to {@link #DISABLED} by an explicit governance action; it is never
 * silently re-enabled. {@link #REJECTED} is reserved for future admission
 * control and is excluded from lookups the same way as {@code DISABLED}.
 */
public enum AdmissionStatus {
    ADMITTED,
    DISABLED,
    REJECTED
}
