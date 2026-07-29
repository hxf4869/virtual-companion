package com.virtualcompanion.modelruntime.contract;

/**
 * Complete immutable identity attached to every normalized adapter event.
 *
 * <p>External attempts bind both authorization snapshots. Deterministic sources
 * are deliberately distinct because they do not create or represent an
 * external {@code provider_attempt}.</p>
 */
public sealed interface InvocationBinding
        permits InvocationBinding.ExternalAttemptBinding,
        InvocationBinding.DeterministicSourceBinding {

    OwnershipTuple ownership();

    long fence();

    String executionId();

    record ExternalAttemptBinding(
            OwnershipTuple ownership,
            String providerAttemptId,
            long fence,
            String requestedAuthorizationSnapshotId,
            String executionAuthorizationSnapshotId
    ) implements InvocationBinding {

        public ExternalAttemptBinding {
            ownership = ContractChecks.requireNonNull(ownership, "ownership");
            providerAttemptId = ContractChecks.requireNonBlank(providerAttemptId, "providerAttemptId");
            fence = ContractChecks.requireNonNegative(fence, "fence");
            requestedAuthorizationSnapshotId = ContractChecks.requireNonBlank(
                    requestedAuthorizationSnapshotId,
                    "requestedAuthorizationSnapshotId"
            );
            executionAuthorizationSnapshotId = ContractChecks.requireNonBlank(
                    executionAuthorizationSnapshotId,
                    "executionAuthorizationSnapshotId"
            );
        }

        @Override
        public String executionId() {
            return providerAttemptId;
        }
    }

    record DeterministicSourceBinding(
            OwnershipTuple ownership,
            String deterministicSourceId,
            long fence
    ) implements InvocationBinding {

        public DeterministicSourceBinding {
            ownership = ContractChecks.requireNonNull(ownership, "ownership");
            deterministicSourceId = ContractChecks.requireNonBlank(
                    deterministicSourceId,
                    "deterministicSourceId"
            );
            fence = ContractChecks.requireNonNegative(fence, "fence");
        }

        @Override
        public String executionId() {
            return deterministicSourceId;
        }
    }
}
