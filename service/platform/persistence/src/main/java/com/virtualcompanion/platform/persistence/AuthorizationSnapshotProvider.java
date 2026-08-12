package com.virtualcompanion.platform.persistence;

/**
 * Creates the dual requested + execution authorization snapshots one external
 * provider attempt binds (INV-AUTH-001), and mirrors them into the in-memory
 * store the {@code ExecutionAuthorizationGuard} reads.
 *
 * <p><b>Implementation status (TASK-0177):</b> this is a seam only. No bean is
 * wired in TASK-0177 because the runtime write path for
 * {@code authorization_snapshot} requires a SECURITY DEFINER function
 * (V16 revoked direct INSERT/UPDATE/DELETE from every runtime role, and no
 * {@code create_authorization_snapshot} SD function exists yet). A future C4
 * task (TASK-0178) adds the SD function and wires a JDBC-backed provider; until
 * then the generation handler's external branch is not runtime-active
 * ({@code ObjectProvider#getIfAvailable} returns {@code null}), consistent with
 * there being no loopback adapter that accepts an {@code ExternalAttemptBinding}.
 * The external persistence + audit chain (record_provider_attempt, finalize with
 * real usage, terminal dispatch) is wired and unit/DB-tested regardless.
 */
public interface AuthorizationSnapshotProvider {

    /**
     * Mint and persist the requested + execution authorization snapshots for
     * one generation's external attempt, and mirror them into the in-memory
     * store so the guard can {@code find()} them before the invoker opens a
     * session.
     *
     * @return the two snapshot ids to bind into the {@code RoutingRequest} and
     *     the {@code ExternalAttemptBinding}
     */
    SnapshotIds createFor(long ownerUserId, long generationId);

    /** The two snapshot ids one external attempt binds. */
    record SnapshotIds(String requestedId, String executionId) {

        public SnapshotIds {
            if (requestedId == null || requestedId.isBlank()) {
                throw new IllegalArgumentException("requestedId must not be blank");
            }
            if (executionId == null || executionId.isBlank()) {
                throw new IllegalArgumentException("executionId must not be blank");
            }
        }
    }
}
