package com.virtualcompanion.modelruntime.authorization;

import java.util.Objects;

/**
 * Supplier-neutral contract reference bound into an authorization snapshot.
 */
public record ProviderContractRef(String value) {

    public ProviderContractRef {
        Objects.requireNonNull(value, "ProviderContractRef value must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException("ProviderContractRef value must not be blank");
        }
    }
}
