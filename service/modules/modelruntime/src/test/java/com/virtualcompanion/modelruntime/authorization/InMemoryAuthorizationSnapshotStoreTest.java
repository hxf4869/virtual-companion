package com.virtualcompanion.modelruntime.authorization;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.virtualcompanion.modelruntime.registry.ProviderId;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for the one-way lifecycle of
 * {@link InMemoryAuthorizationSnapshotStore}: insert-only {@code put}, and
 * {@code withdraw}/{@code narrow} accepting only {@code ACTIVE} snapshots —
 * aligned with {@code JdbcAuthorizationSnapshotStore} (TASK-0144) and the
 * port contract "must not resurrect withdrawn or narrowed snapshots".
 */
class InMemoryAuthorizationSnapshotStoreTest {

    private final InMemoryAuthorizationSnapshotStore store =
            new InMemoryAuthorizationSnapshotStore();

    private static AuthorizationSnapshot activeSnapshot(String id) {
        return new AuthorizationSnapshot(
                new AuthorizationSnapshotId(id),
                AuthorizationStatus.ACTIVE,
                new ProviderId("prov-1"),
                new ProviderRegion("eu"),
                new ProviderContractRef("contract-1"),
                ProcessingPurpose.COMPANION_CHAT,
                Set.of(DataCategory.MESSAGE_TEXT),
                false,
                false);
    }

    @Test
    void putStoresAndReturnsSnapshot() {
        AuthorizationSnapshot snapshot = activeSnapshot("snap-1");
        assertEquals(snapshot, store.put(snapshot));
        assertEquals(snapshot, store.find(new AuthorizationSnapshotId("snap-1")).orElseThrow());
    }

    @Test
    void putRejectsDuplicateIdFailClosed() {
        store.put(activeSnapshot("snap-1"));
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.put(activeSnapshot("snap-1")));
        assertTrue(exc.getMessage().contains("already stored"));
    }

    @Test
    void withdrawTransitionsActiveSnapshot() {
        store.put(activeSnapshot("snap-1"));
        AuthorizationSnapshot withdrawn = store.withdraw(new AuthorizationSnapshotId("snap-1"));
        assertEquals(AuthorizationStatus.WITHDRAWN, withdrawn.status());
        assertEquals(AuthorizationStatus.WITHDRAWN,
                store.find(new AuthorizationSnapshotId("snap-1")).orElseThrow().status());
    }

    @Test
    void withdrawMissingSnapshotFailsClosed() {
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.withdraw(new AuthorizationSnapshotId("snap-missing")));
        assertTrue(exc.getMessage().contains("not stored"));
    }

    @Test
    void withdrawTerminalSnapshotFailsClosed() {
        store.put(activeSnapshot("snap-1"));
        store.withdraw(new AuthorizationSnapshotId("snap-1"));
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.withdraw(new AuthorizationSnapshotId("snap-1")));
        assertTrue(exc.getMessage().contains("cannot be withdrawn"));
        assertTrue(exc.getMessage().contains("only ACTIVE may transition"));
    }

    @Test
    void withdrawNarrowedSnapshotFailsClosed() {
        store.put(activeSnapshot("snap-1"));
        store.narrow(new AuthorizationSnapshotId("snap-1"), activeSnapshot("snap-1"));
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.withdraw(new AuthorizationSnapshotId("snap-1")));
        assertTrue(exc.getMessage().contains("cannot be withdrawn"));
        assertTrue(exc.getMessage().contains("only ACTIVE may transition"));
    }

    @Test
    void narrowTransitionsActiveSnapshot() {
        store.put(activeSnapshot("snap-1"));
        AuthorizationSnapshot narrowed =
                store.narrow(new AuthorizationSnapshotId("snap-1"), activeSnapshot("snap-1"));
        assertEquals(AuthorizationStatus.NARROWED, narrowed.status());
        assertEquals(AuthorizationStatus.NARROWED,
                store.find(new AuthorizationSnapshotId("snap-1")).orElseThrow().status());
    }

    @Test
    void narrowMissingSnapshotFailsClosed() {
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.narrow(new AuthorizationSnapshotId("snap-missing"),
                        activeSnapshot("snap-missing")));
        assertTrue(exc.getMessage().contains("not stored"));
    }

    @Test
    void narrowRequiresMatchingId() {
        store.put(activeSnapshot("snap-1"));
        IllegalArgumentException exc = assertThrows(IllegalArgumentException.class,
                () -> store.narrow(new AuthorizationSnapshotId("snap-1"),
                        activeSnapshot("snap-other")));
        assertTrue(exc.getMessage().contains("must equal the target id"));
    }

    @Test
    void narrowTerminalSnapshotFailsClosed() {
        store.put(activeSnapshot("snap-1"));
        store.narrow(new AuthorizationSnapshotId("snap-1"), activeSnapshot("snap-1"));
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.narrow(new AuthorizationSnapshotId("snap-1"),
                        activeSnapshot("snap-1")));
        assertTrue(exc.getMessage().contains("cannot be narrowed"));
        assertTrue(exc.getMessage().contains("only ACTIVE may transition"));
    }

    @Test
    void narrowWithdrawnSnapshotFailsClosed() {
        store.put(activeSnapshot("snap-1"));
        store.withdraw(new AuthorizationSnapshotId("snap-1"));
        IllegalStateException exc = assertThrows(IllegalStateException.class,
                () -> store.narrow(new AuthorizationSnapshotId("snap-1"),
                        activeSnapshot("snap-1")));
        assertTrue(exc.getMessage().contains("cannot be narrowed"));
        assertTrue(exc.getMessage().contains("only ACTIVE may transition"));
    }
}
