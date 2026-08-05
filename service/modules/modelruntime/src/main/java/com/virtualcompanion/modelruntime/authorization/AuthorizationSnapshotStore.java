package com.virtualcompanion.modelruntime.authorization;

import java.util.Optional;

/**
 * Store for authorization snapshots. Implementations must fail closed on
 * missing identities and must not resurrect withdrawn or narrowed snapshots.
 */
public interface AuthorizationSnapshotStore {

    AuthorizationSnapshot put(AuthorizationSnapshot snapshot);

    Optional<AuthorizationSnapshot> find(AuthorizationSnapshotId id);

    AuthorizationSnapshot withdraw(AuthorizationSnapshotId id);

    AuthorizationSnapshot narrow(
            AuthorizationSnapshotId id,
            AuthorizationSnapshot narrowed
    );
}
