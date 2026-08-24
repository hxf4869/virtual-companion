package com.virtualcompanion.modelruntime.execution;

import java.util.Objects;

/** Immutable operator version identity for one provisioned provider deployment. */
public record ProviderDeploymentMetadata(
        String modelId,
        String modelRevision,
        String configVersion) {

    public ProviderDeploymentMetadata {
        modelId = requireNonBlank(modelId, "modelId");
        modelRevision = requireNonBlank(modelRevision, "modelRevision");
        configVersion = requireNonBlank(configVersion, "configVersion");
    }

    private static String requireNonBlank(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
