package com.virtualcompanion.runtime.auth.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.modelruntime.execution.ActiveInvocationRegistry;
import com.virtualcompanion.platform.persistence.AccountDeletionIntentService;
import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import com.virtualcompanion.runtime.export.ExportObjectStorage;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

/**
 * DOGFOOD-STABILIZATION-02 (ADR-0006 §7): the anti-race order is pinned —
 * intent FIRST, then in-flight cancellation, then a pointer cleanup that
 * loops until the worklist is empty (one SQL pass sees at most LIMIT 500)
 * and re-checks once more before the caller's cascade; pointer rows without
 * wired storage abort the deletion instead of orphaning behind the cascade.
 */
class AccountDeletionCoordinatorTest {

    @SuppressWarnings("unchecked")
    private static ObjectProvider<ActiveInvocationRegistry> registryProvider(
            ActiveInvocationRegistry registry) {
        ObjectProvider<ActiveInvocationRegistry> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(registry);
        return provider;
    }

    @SuppressWarnings("unchecked")
    private static <T> ObjectProvider<T> provider(T available) {
        ObjectProvider<T> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(available);
        return provider;
    }

    /** Storage fake that records deletions and can fail on demand. */
    private static final class FakeStorage implements ExportObjectStorage {
        final AtomicInteger deletes = new AtomicInteger();
        String failKey;

        @Override
        public void put(String key, byte[] bytes) {
            throw new UnsupportedOperationException();
        }

        @Override
        public byte[] get(String key) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void delete(String key) {
            if (key.equals(failKey)) {
                throw new IllegalStateException("object store unreachable");
            }
            deletes.incrementAndGet();
        }

        @Override
        public java.util.List<String> list(String prefix) {
            return java.util.List.of();
        }

        @Override
        public ExportObjectStorage.ObjectListing listPage(
                String prefix, String startAfter, int limit) {
            return new ExportObjectStorage.ObjectListing(java.util.List.of(), null);
        }
    }

    /** Both owner-tx entry points run their segment work immediately. */
    private void stubOwnerTx(OwnerContext owners) {
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(owners).asOwnerRequiresNew(anyLong(), any(Runnable.class));
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(owners).asOwner(anyLong(), any(Runnable.class));
    }

    private static ExportService.ExpiredExportObject pointer(long exportId) {
        return new ExportService.ExpiredExportObject(7L, exportId, "exports/7/" + exportId + ".json");
    }

    @Test
    void commitsIntentBeforeSignallingAndAuditsSignalCount() {
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        ActiveInvocationRegistry registry = mock(ActiveInvocationRegistry.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        when(registry.cancelOwner(7L)).thenReturn(2);
        stubOwnerTx(owners);

        int signalled = new AccountDeletionCoordinator(
                owners, intents, registryProvider(registry)).prepare(7L);

        assertEquals(2, signalled);
        var order = inOrder(owners, intents, registry);
        order.verify(owners).asOwnerRequiresNew(eq(7L), any(Runnable.class));
        order.verify(intents).requestCurrent(7L);
        order.verify(registry).cancelOwner(7L);
        order.verify(owners).asOwnerRequiresNew(eq(7L), any(Runnable.class));
        order.verify(intents).recordCancelSignalsCurrent(7L, 2);
    }

    @Test
    void intentIsPersistedBeforeAnyObjectCleanupRuns() {
        // DOGFOOD-STABILIZATION-02: the intent must be durable BEFORE the
        // first bucket delete so new exports/seals are already blocked while
        // the cleanup races.
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(
                List.of(pointer(11L)), List.of());

        new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), null).prepare(7L);

        // FakeStorage is not a mock: its single delete is asserted directly;
        // the mock order pins the intent commit before the pointer clear that
        // follows the bucket delete.
        var order = inOrder(intents, exports);
        order.verify(intents).requestCurrent(7L);
        order.verify(exports).clearObject(7L, 11L, "exports/7/11.json");
        assertEquals(1, storage.deletes.get());
    }

    @Test
    void intentRejectionAbortsBeforeAnyCleanup() {
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(false);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(
                List.of(pointer(11L)), List.of());

        assertThrows(IllegalStateException.class, () -> new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), null).prepare(7L));

        assertEquals(0, storage.deletes.get());
        verify(exports, never()).listOwnerObjects(anyLong());
    }

    @Test
    void loopsBeyondOneSqlPageUntilTheWorklistIsEmpty() {
        // One SQL pass sees at most LIMIT 500 — the cleanup must re-list and
        // continue (here: two full passes of 500 plus one leftover row).
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        List<ExportService.ExpiredExportObject> pageOne = new ArrayList<>();
        List<ExportService.ExpiredExportObject> pageTwo = new ArrayList<>();
        for (long id = 1000; id < 1500; id++) {
            pageOne.add(pointer(id));
        }
        for (long id = 2000; id < 2500; id++) {
            pageTwo.add(pointer(id));
        }
        when(exports.listOwnerObjects(7L)).thenReturn(
                pageOne, pageTwo, List.of(), List.of());

        new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), null).prepare(7L);

        assertEquals(1000, storage.deletes.get());
        verify(exports, org.mockito.Mockito.times(1000))
                .clearObject(eq(7L), anyLong(), anyString());
    }

    @Test
    void lateSealedPointerReappearingBeforeTheCascadeAbortsTheDeletion() {
        // A seal that slipped past the intent check lands between the last
        // cleanup pass and the cascade — the final re-check must abort.
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(
                List.of(pointer(11L)), List.of(), List.of(pointer(99L)));
        AlertNotifier alerts = mock(AlertNotifier.class);

        assertThrows(IllegalStateException.class, () -> new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), alerts).prepare(7L));

        assertEquals(1, storage.deletes.get());
        verify(alerts).alert(eq(AlertSeverity.P1),
                eq(AccountDeletionCoordinator.ALERT_OBJECT_BLOCKED), anyString());
    }

    @Test
    void anObjectDeletionFailureAbortsTheAccountDeletionWithP1() {
        // Never lose the pointer while the object lives: the deletion is
        // aborted (the caller surfaces the existing non-disclosing error).
        // The intent was already committed — retrying the deletion is the
        // safe direction.
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        storage.failKey = "exports/7/12.json";
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(
                List.of(pointer(11L), pointer(12L)));
        AlertNotifier alerts = mock(AlertNotifier.class);

        assertThrows(IllegalStateException.class, () -> new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), alerts).prepare(7L));

        verify(alerts).alert(eq(AlertSeverity.P1),
                eq(AccountDeletionCoordinator.ALERT_OBJECT_BLOCKED), anyString());
        // The FIRST object was already deleted (its pointer cleared before
        // the failure); the FAILED object's pointer survives untouched.
        assertEquals(1, storage.deletes.get());
        verify(exports).clearObject(7L, 11L, "exports/7/11.json");
        verify(exports, never()).clearObject(7L, 12L, "exports/7/12.json");
    }

    @Test
    void aTransientPointerClearFailureIsRetriedOnTheNextPass() {
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(
                List.of(pointer(11L), pointer(12L)),
                List.of(pointer(12L)),
                List.of(),
                List.of());
        when(exports.clearObject(7L, 12L, "exports/7/12.json"))
                .thenThrow(new IllegalStateException("db hiccup"))
                .thenReturn(true);

        new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), null).prepare(7L);

        assertEquals(3, storage.deletes.get());
        verify(exports).clearObject(7L, 11L, "exports/7/11.json");
        verify(exports, org.mockito.Mockito.times(2))
                .clearObject(7L, 12L, "exports/7/12.json");
    }

    @Test
    void aPersistentlyUnclearablePointerAbortsInsteadOfLooping() {
        // The no-progress guard: a whole pass without one cleared row aborts
        // the deletion with P1 rather than spinning forever.
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(List.of(pointer(11L)));
        when(exports.clearObject(7L, 11L, "exports/7/11.json"))
                .thenThrow(new IllegalStateException("db down"));
        AlertNotifier alerts = mock(AlertNotifier.class);

        assertThrows(IllegalStateException.class, () -> new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), alerts).prepare(7L));

        verify(alerts).alert(eq(AlertSeverity.P1),
                eq(AccountDeletionCoordinator.ALERT_OBJECT_BLOCKED), anyString());
    }

    @Test
    void retryAfterSuccessfulObjectsIsSafeBecauseDeletesAreIdempotent() {
        // Account deletion DB failure after objects were removed: the retry
        // re-lists the same pointers, deletes (no-ops) again and proceeds.
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        FakeStorage storage = new FakeStorage();
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(
                List.of(pointer(11L)), List.of(), List.of(),
                List.of(pointer(11L)), List.of(), List.of());

        AccountDeletionCoordinator coordinator = new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                provider(storage), provider(exports), null);
        coordinator.prepare(7L);
        coordinator.prepare(7L);

        assertEquals(2, storage.deletes.get());
        verify(exports, org.mockito.Mockito.times(2))
                .clearObject(7L, 11L, "exports/7/11.json");
    }

    @Test
    void pointerRowsWithoutWiredStorageAbortTheDeletion() {
        // Fail-closed: the cascade must not destroy the only record of
        // objects this deployment can no longer address.
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);
        ExportService exports = mock(ExportService.class);
        when(exports.listOwnerObjects(7L)).thenReturn(List.of(pointer(11L)));
        AlertNotifier alerts = mock(AlertNotifier.class);

        assertThrows(IllegalStateException.class, () -> new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                null, provider(exports), alerts).prepare(7L));

        verify(alerts).alert(eq(AlertSeverity.P1),
                eq(AccountDeletionCoordinator.ALERT_OBJECT_BLOCKED), anyString());
    }

    @Test
    void inlineModeWithoutPointersSkipsTheObjectCleanupEntirely() {
        OwnerContext owners = mock(OwnerContext.class);
        AccountDeletionIntentService intents = mock(AccountDeletionIntentService.class);
        when(intents.requestCurrent(7L)).thenReturn(true);
        stubOwnerTx(owners);

        new AccountDeletionCoordinator(
                owners, intents, registryProvider(mock(ActiveInvocationRegistry.class)),
                null, null, null).prepare(7L);

        verify(intents).requestCurrent(7L);
    }
}
