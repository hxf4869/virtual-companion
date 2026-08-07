package com.virtualcompanion.modelruntime.execution;

import com.virtualcompanion.catalog.ProviderAttemptStatus;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import java.util.Objects;

/**
 * Immutable audit record for one real outbound provider attempt.
 *
 * <p>Deliberately carries no credentials, request body or response text: the
 * audit chain records identity and outcome so a real attempt is provable
 * without ever leaking the platform secret into a business type, log line or
 * API response (TASK-0035 acceptance: credentials never enter the repository,
 * logs or business types). {@code supplierName} comes from runtime
 * configuration, never a hard-coded vendor name.</p>
 */
public record ProviderAttemptAudit(
        String providerAttemptId,
        OwnershipTuple ownership,
        String providerId,
        String supplierName,
        ProviderAttemptStatus status) {

    public ProviderAttemptAudit {
        providerAttemptId = requireNonBlank(providerAttemptId, "providerAttemptId");
        Objects.requireNonNull(ownership, "ownership must not be null");
        providerId = requireNonBlank(providerId, "providerId");
        supplierName = requireNonBlank(supplierName, "supplierName");
        Objects.requireNonNull(status, "status must not be null");
    }

    private static String requireNonBlank(String value, String name) {
        Objects.requireNonNull(value, name + " must not be null");
        if (value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
