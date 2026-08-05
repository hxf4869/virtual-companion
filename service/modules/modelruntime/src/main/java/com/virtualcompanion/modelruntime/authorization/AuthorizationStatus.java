package com.virtualcompanion.modelruntime.authorization;

/**
 * Lifecycle of an authorization snapshot.
 * <p>
 * ACTIVE may be used for new external attempts. WITHDRAWN and NARROWED must
 * fail closed: pending work cannot reuse them for outbound transfer.
 */
public enum AuthorizationStatus {
    ACTIVE,
    WITHDRAWN,
    NARROWED
}
