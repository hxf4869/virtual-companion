package com.virtualcompanion.modelruntime.authorization;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.Objects;
import java.util.Set;

/**
 * Immutable requested or execution-time authorization snapshot.
 * <p>
 * Snapshots are value objects. Withdrawal or narrowing is modeled by status
 * transition on the store, never by mutating an existing instance in place.
 */
public record AuthorizationSnapshot(
        AuthorizationSnapshotId id,
        AuthorizationStatus status,
        ProviderId providerId,
        ProviderRegion region,
        ProviderContractRef contractRef,
        ProcessingPurpose purpose,
        Set<DataCategory> dataCategories,
        boolean taskCancelled,
        boolean sourceDataDeleted
) {

    public AuthorizationSnapshot {
        Objects.requireNonNull(id, "id must not be null");
        Objects.requireNonNull(status, "status must not be null");
        Objects.requireNonNull(providerId, "providerId must not be null");
        Objects.requireNonNull(region, "region must not be null");
        Objects.requireNonNull(contractRef, "contractRef must not be null");
        Objects.requireNonNull(purpose, "purpose must not be null");
        Objects.requireNonNull(dataCategories, "dataCategories must not be null");
        if (dataCategories.isEmpty()) {
            throw new IllegalArgumentException("dataCategories must not be empty");
        }
        dataCategories = Set.copyOf(dataCategories);
    }

    public boolean isActive() {
        return status == AuthorizationStatus.ACTIVE;
    }
}
