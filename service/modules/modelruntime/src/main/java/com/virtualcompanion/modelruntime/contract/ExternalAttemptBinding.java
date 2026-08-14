package com.virtualcompanion.modelruntime.contract;

/**
 * Immutable attempt identity materialized during the prepare phase (TASK-0194).
 *
 * <p>This is the attempt identity the {@code prepare} phase fixes BEFORE any
 * outbound transfer so the network phase can consume only immutable objects:
 * the {@code providerAttemptId} (unique, the audit anchor), the provider /
 * supplier identity, the dual authorization snapshot ids and the ownership.
 * The worker binds this identity into the {@code provider_attempt} intent row
 * (status {@code CREATED}) in the same prepare transaction; a failure to
 * persist the intent forbids the outbound (adapter zero calls).</p>
 *
 * <p>Deliberately carries no credentials, claim token, request body or
 * response text: the raw claim token/fence never leave the worker memory (only
 * SHA-256 hashes are persisted by the database intent row).</p>
 */
public record ExternalAttemptBinding(
        OwnershipTuple ownership,
        String providerAttemptId,
        long fence,
        String providerId,
        String supplierName,
        String requestedAuthorizationSnapshotId,
        String executionAuthorizationSnapshotId) {

    public ExternalAttemptBinding {
        ownership = ContractChecks.requireNonNull(ownership, "ownership");
        providerAttemptId = ContractChecks.requireNonBlank(providerAttemptId, "providerAttemptId");
        fence = ContractChecks.requireNonNegative(fence, "fence");
        providerId = ContractChecks.requireNonBlank(providerId, "providerId");
        supplierName = ContractChecks.requireNonBlank(supplierName, "supplierName");
        requestedAuthorizationSnapshotId = ContractChecks.requireNonBlank(
                requestedAuthorizationSnapshotId,
                "requestedAuthorizationSnapshotId"
        );
        executionAuthorizationSnapshotId = ContractChecks.requireNonBlank(
                executionAuthorizationSnapshotId,
                "executionAuthorizationSnapshotId"
        );
    }
}
