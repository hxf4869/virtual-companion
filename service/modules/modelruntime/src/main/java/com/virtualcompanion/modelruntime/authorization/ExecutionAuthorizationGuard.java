package com.virtualcompanion.modelruntime.authorization;

import com.virtualcompanion.modelruntime.contract.InvocationBinding;
import com.virtualcompanion.modelruntime.contract.OwnershipTuple;
import com.virtualcompanion.modelruntime.registry.AdmissionStatus;
import com.virtualcompanion.modelruntime.registry.ProviderRegistry;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * Unified pre-outbound authorization guard.
 * <p>
 * Enforces the dual-snapshot rule from
 * {@code specs/contracts/authorization-contract.yaml}: every external attempt
 * must bind both a requested and an execution authorization snapshot, and
 * execution-time checks must fail closed with no external data transfer and
 * quota release on denial.
 */
public final class ExecutionAuthorizationGuard {

    private final AuthorizationSnapshotStore snapshotStore;
    private final ProviderRegistry providerRegistry;

    public ExecutionAuthorizationGuard(
            AuthorizationSnapshotStore snapshotStore,
            ProviderRegistry providerRegistry
    ) {
        this.snapshotStore = Objects.requireNonNull(snapshotStore, "snapshotStore");
        this.providerRegistry = Objects.requireNonNull(providerRegistry, "providerRegistry");
    }

    /**
     * Authorize an external attempt binding immediately before outbound transfer.
     */
    public ExecutionAuthorizationDecision authorize(
            InvocationBinding.ExternalAttemptBinding binding
    ) {
        Objects.requireNonNull(binding, "binding must not be null");

        AuthorizationSnapshotId requestedId =
                new AuthorizationSnapshotId(binding.requestedAuthorizationSnapshotId());
        AuthorizationSnapshotId executionId =
                new AuthorizationSnapshotId(binding.executionAuthorizationSnapshotId());

        Optional<AuthorizationSnapshot> requestedOpt = snapshotStore.find(requestedId);
        if (requestedOpt.isEmpty()) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: requested snapshot missing");
        }
        Optional<AuthorizationSnapshot> executionOpt = snapshotStore.find(executionId);
        if (executionOpt.isEmpty()) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: execution snapshot missing");
        }

        AuthorizationSnapshot requested = requestedOpt.get();
        AuthorizationSnapshot execution = executionOpt.get();

        ExecutionAuthorizationDecision requestedDecision = evaluateSnapshot(
                requested,
                "requested"
        );
        if (!requestedDecision.allowed()) {
            return requestedDecision;
        }
        ExecutionAuthorizationDecision executionDecision = evaluateSnapshot(
                execution,
                "execution"
        );
        if (!executionDecision.allowed()) {
            return executionDecision;
        }

        if (!execution.purpose().equals(requested.purpose())) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: execution purpose drifts from requested");
        }
        if (!requested.dataCategories().containsAll(execution.dataCategories())) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: execution data categories exceed requested");
        }
        if (!execution.providerId().equals(requested.providerId())
                || !execution.region().equals(requested.region())
                || !execution.contractRef().equals(requested.contractRef())) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: execution provider/region/contract drifts from requested");
        }

        return ExecutionAuthorizationDecision.allow();
    }

    /**
     * Authorize a dual-snapshot pair without constructing a full attempt binding.
     */
    public ExecutionAuthorizationDecision authorize(
            AuthorizationSnapshotId requestedId,
            AuthorizationSnapshotId executionId
    ) {
        Objects.requireNonNull(requestedId, "requestedId must not be null");
        Objects.requireNonNull(executionId, "executionId must not be null");
        InvocationBinding.ExternalAttemptBinding binding =
                new InvocationBinding.ExternalAttemptBinding(
                        new OwnershipTuple(
                                "owner",
                                "relationship",
                                "conversation",
                                "generation"
                        ),
                        "provider-attempt",
                        0L,
                        requestedId.value(),
                        executionId.value()
                );
        return authorize(binding);
    }

    private ExecutionAuthorizationDecision evaluateSnapshot(
            AuthorizationSnapshot snapshot,
            String label
    ) {
        if (!snapshot.isActive()) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: " + label + " snapshot is "
                            + snapshot.status());
        }
        if (snapshot.taskCancelled()) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: " + label + " task is cancelled");
        }
        if (snapshot.sourceDataDeleted()) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: " + label + " source data deleted");
        }

        boolean admitted = providerRegistry.deployments().stream()
                .anyMatch(item ->
                        item.providerId().equals(snapshot.providerId())
                                && item.admissionStatus() == AdmissionStatus.ADMITTED);
        if (!admitted) {
            return ExecutionAuthorizationDecision.deny(
                    "CANCELLED_BY_AUTHORIZATION: " + label
                            + " provider is not admitted in registry");
        }
        return ExecutionAuthorizationDecision.allow();
    }

    /**
     * Verify purpose and categories coverage without constructing full bindings.
     */
    static boolean currentConsentCovers(
            AuthorizationSnapshot snapshot,
            ProcessingPurpose purpose,
            Set<DataCategory> categories
    ) {
        Objects.requireNonNull(snapshot, "snapshot");
        Objects.requireNonNull(purpose, "purpose");
        Objects.requireNonNull(categories, "categories");
        return snapshot.isActive()
                && snapshot.purpose() == purpose
                && snapshot.dataCategories().containsAll(categories);
    }
}
