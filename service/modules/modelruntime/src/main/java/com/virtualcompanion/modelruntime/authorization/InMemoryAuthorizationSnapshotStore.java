package com.virtualcompanion.modelruntime.authorization;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Thread-safe in-memory {@link AuthorizationSnapshotStore}.
 *
 * <p>The snapshot lifecycle is one-way: {@code ACTIVE -> WITHDRAWN} and
 * {@code ACTIVE -> NARROWED} are the only legal transitions, and a terminal
 * snapshot can never be resurrected or re-transitioned — aligned with
 * {@code JdbcAuthorizationSnapshotStore} and the port contract "must not
 * resurrect withdrawn or narrowed snapshots".
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
        // compute keeps the check-then-put atomic, so a concurrent narrow can
        // never overwrite a withdrawn snapshot (terminal states stay final).
        return snapshots.compute(id, (key, current) -> {
            AuthorizationSnapshot present = requirePresent(id);
            if (present.status() != AuthorizationStatus.ACTIVE) {
                throw transitionFailure(id, "withdrawn", present);
            }
            return copyWithStatus(present, AuthorizationStatus.WITHDRAWN);
        });
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
        return snapshots.compute(id, (key, current) -> {
            AuthorizationSnapshot present = requirePresent(id);
            if (present.status() != AuthorizationStatus.ACTIVE) {
                throw transitionFailure(id, "narrowed", present);
            }
            return copyWithStatus(narrowed, AuthorizationStatus.NARROWED);
        });
    }

    private AuthorizationSnapshot requirePresent(AuthorizationSnapshotId id) {
        AuthorizationSnapshot current = snapshots.get(id);
        if (current == null) {
            throw new IllegalStateException(
                    "authorization snapshot " + id + " is not stored");
        }
        return current;
    }

    private IllegalStateException transitionFailure(
            AuthorizationSnapshotId id,
            String target,
            AuthorizationSnapshot current
    ) {
        return new IllegalStateException(
                "authorization snapshot " + id + " cannot be " + target
                        + " from status " + current.status().name()
                        + " (only ACTIVE may transition)");
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
