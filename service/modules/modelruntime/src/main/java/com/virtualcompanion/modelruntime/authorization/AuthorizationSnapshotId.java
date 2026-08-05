package com.virtualcompanion.modelruntime.authorization;

import java.util.Objects;

/**
 * Immutable opaque identity of one authorization snapshot.
 */
public record AuthorizationSnapshotId(String value) {

    public AuthorizationSnapshotId {
        Objects.requireNonNull(value, "AuthorizationSnapshotId value must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException("AuthorizationSnapshotId value must not be blank");
        }
    }
}
