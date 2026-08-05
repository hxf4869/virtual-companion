package com.virtualcompanion.platform.persistence;

import java.util.List;

/**
 * Durable row representation of a provider deployment.
 *
 * <p>This is the persistence-layer view of {@code ProviderDeployment}; it stores
 * the durable admission-state metadata only. The protocol and capability codes
 * are kept as plain strings so the persistence module does not depend on the
 * catalog-generated enum types — the live {@code ProviderRegistry} re-binds these
 * to {@code ModelProtocol}/{@code ModelProtocolCapabilities} and the in-memory
 * adapter objects at runtime.
 *
 * <p>{@code admissionState} is one of {@code ADMITTED}, {@code DISABLED} or
 * {@code REJECTED}, enforced by the table's CHECK constraint.
 */
public record ProviderDeploymentRecord(
        String providerId,
        String protocol,
        List<String> capabilities,
        String admissionState) {

    public ProviderDeploymentRecord {
        if (providerId == null || providerId.isBlank()) {
            throw new IllegalArgumentException("providerId must not be blank");
        }
        if (protocol == null || protocol.isBlank()) {
            throw new IllegalArgumentException("protocol must not be blank");
        }
        capabilities = capabilities == null ? List.of() : List.copyOf(capabilities);
        if (admissionState == null || admissionState.isBlank()) {
            throw new IllegalArgumentException("admissionState must not be blank");
        }
    }

    public boolean isAdmitted() {
        return "ADMITTED".equals(admissionState);
    }
}
