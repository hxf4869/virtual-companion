package com.virtualcompanion.modelruntime.authorization;

import java.util.Objects;

/**
 * Supplier-neutral region label for execution authorization.
 */
public record ProviderRegion(String value) {

    public ProviderRegion {
        Objects.requireNonNull(value, "ProviderRegion value must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException("ProviderRegion value must not be blank");
        }
    }
}
