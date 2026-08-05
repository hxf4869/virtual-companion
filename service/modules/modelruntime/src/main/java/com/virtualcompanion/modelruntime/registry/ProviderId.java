package com.virtualcompanion.modelruntime.registry;

import java.util.Objects;

/**
 * Immutable supplier-neutral identity for a registered provider deployment.
 * <p>
 * A {@code ProviderId} is a stable opaque label assigned by the governance
 * layer; it never encodes model names, vendor SDK identifiers, API keys or
 * deployment endpoints. Two deployments that share a {@code ProviderId} are
 * the same logical admission slot.
 */
public record ProviderId(String value) {

    public ProviderId {
        Objects.requireNonNull(value, "ProviderId value must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException("ProviderId value must not be blank");
        }
    }
}
