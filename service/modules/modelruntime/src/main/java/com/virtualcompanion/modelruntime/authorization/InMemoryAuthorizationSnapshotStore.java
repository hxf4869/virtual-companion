package com.virtualcompanion.modelruntime.authorization;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe in-memory {@link AuthorizationSnapshotStore}.
 */
public final class InMemoryAuthorizationSnapshotStore implements AuthorizationSnapshotStore {

    private final Map<AuthorizationSnapshotId, AuthorizationSnapshot> snapshots =
            new ConcurrentHashMap<>();

    @Override
    public AuthorizationSnapshot put(AuthorizationSnapshot snapshot) {
        Objects.requireNonNull(snapshot, "snapshot must not be null");
        AuthorizationSnapshot existing = snapshots.putIfAbsent(snapshot.id(), snapshot);
        if (existing != null) {
            throw new IllegalStateException(
                    "authorization snapshot " + snapshot.id() + " is already stored");
        }
        return snapshot;
    }

    @Override
    public Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id) {
        Objects.requireNonNull(id, "id must not be null");
        return Optional.ofNullable(snapshots.get(id));
    }

    @Override
    public AuthorizationSnapshot withdraw(AuthorizationSnapshotId id) {
        Objects.requireNonNull(id, "id must not be null");
        AuthorizationSnapshot current = requirePresent(id);
        AuthorizationSnapshot withdrawn = copyWithStatus(current, AuthorizationStatus.WITHDRAWN);
        snapshots.put(id, withdrawn);
        return withdrawn;
    }

    @Override
    public AuthorizationSnapshot narrow(
            AuthorizationSnapshotId id,
            AuthorizationSnapshot narrowed
    ) {
        Objects.requireNonNull(id, "id must not be null");
        Objects.requireNonNull(narrowed, "narrowed must not be null");
        if (!id.equals(narrowed.id())) {
            throw new IllegalArgumentException(
                    "narrowed snapshot id must equal the target id");
        }
        requirePresent(id);
        AuthorizationSnapshot result = copyWithStatus(narrowed, AuthorizationStatus.NARROWED);
        snapshots.put(id, result);
        return result;
    }

    private AuthorizationSnapshot requirePresent(AuthorizationSnapshotId id) {
        AuthorizationSnapshot current = snapshots.get(id);
        if (current == null) {
            throw new IllegalStateException(
                    "authorization snapshot " + id + " is not stored");
        }
        return current;
    }

    private static AuthorizationSnapshot copyWithStatus(
            AuthorizationSnapshot source,
            AuthorizationStatus status
    ) {
        return new AuthorizationSnapshot(
                source.id(),
                status,
                source.providerId(),
                source.region(),
                source.contractRef(),
                source.purpose(),
                source.dataCategories(),
                source.taskCancelled(),
                source.sourceDataDeleted()
        );
    }
}
