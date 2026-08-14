package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link WorkItemWorker} (TASK-0194 segmented model): the claim
 * runs inside the owner-bound executor as its own short transaction; every
 * handler call runs with the worker's segment executor installed (the handler
 * uses it for its own short owner-bound transactions); a handler failure
 * triggers an INDEPENDENT per-item fail (fresh owner transaction, only the
 * original work_item_id/claim_token/claim_fence) — never a shared-token batch
 * fail; a {@code 0} per-item result is a rejected late write and is never
 * retried (INV-WORKER-001 fail-closed); logs carry no token/fence.
 */
class WorkItemWorkerTest {

    private final WorkItemClaimService claimService = mock(WorkItemClaimService.class);
    private final WorkItemWorker.OwnerExecutor ownerExecutor = mock(WorkItemWorker.OwnerExecutor.class);
    private final WorkItemHandler handler = mock(WorkItemHandler.class);

    /** Run the Runnable argument of the owner executor synchronously (mock has no transaction). */
    private void runAsOwnerSynchronously() {
        doAnswer(invocation -> {
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(ownerExecutor).asOwner(anyLong(), any(Runnable.class));
    }

    private WorkItemClaim claim(long id) {
        return new WorkItemClaim(7L, id, "GENERATION", id * 10, null, "batch-tok", "FENCE-A");
    }

    @Test
    void claimsInsideOwnerExecutorThenHandlesEachClaimWithSegmentExecutorInstalled() {
        runAsOwnerSynchronously();
        List<WorkItemClaim> claims = List.of(claim(1L), claim(2L));
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(claims);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(2, processed);
        verify(ownerExecutor).asOwner(eq(7L), any(Runnable.class)); // claim-tx
        verify(handler).handle(claims.get(0));
        verify(handler).handle(claims.get(1));
        verify(claimService, never()).complete(any());
        verify(claimService, never()).fail(any());
    }

    @Test
    void handlerCanAccessTheInstalledSegmentExecutor() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(claim(1L)));
        AtomicReference<WorkItemWorker.OwnerExecutor> seen = new AtomicReference<>();
        doAnswer(invocation -> {
            seen.set(WorkItemWorker.segmentExecutor());
            return null;
        }).when(handler).handle(any());

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(ownerExecutor, seen.get());
    }

    @Test
    void handlerFailureTriggersIndependentPerItemFailOnlyForThatItem() {
        runAsOwnerSynchronously();
        List<WorkItemClaim> claims = List.of(claim(1L), claim(2L));
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(claims);
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(claims.get(1));
        when(claimService.failPerItem(2L, "batch-tok", "FENCE-A")).thenReturn(1);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        // Item 1 handled successfully; item 2 failed and was independently
        // failed per item — never the shared-token batch fail.
        assertEquals(1, processed);
        verify(claimService).failPerItem(2L, "batch-tok", "FENCE-A");
        verify(claimService, never()).fail("batch-tok");
    }

    @Test
    void independentFailRejectedWithZeroRowsIsNotRetriedAndDoesNotThrow() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(claim(1L)));
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(any());
        when(claimService.failPerItem(1L, "batch-tok", "FENCE-A")).thenReturn(0);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(claimService, times(1)).failPerItem(1L, "batch-tok", "FENCE-A");
    }

    @Test
    void independentFailTransactionFailureIsContained() {
        // Claim succeeds; the independent-fail owner transaction fails.
        java.util.concurrent.atomic.AtomicInteger calls = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(invocation -> {
            if (calls.incrementAndGet() == 2) {
                throw new IllegalStateException("independent fail tx db down");
            }
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(ownerExecutor).asOwner(anyLong(), any(Runnable.class));
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(claim(1L)));
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(any());

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A"); // must not throw

        assertEquals(0, processed);
    }

    @Test
    void emptyClaimBatchReturnsZeroWithoutHandling() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of());

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(handler, never()).handle(any());
    }

    @Test
    void claimFailureIsContainedAndReturnsZero() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A")))
                .thenThrow(new IllegalStateException("claim db down"));

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(handler, never()).handle(any());
    }

    @Test
    void segmentExecutorOutsideWorkerBatchFailsClosed() {
        assertThrows(IllegalStateException.class, WorkItemWorker::segmentExecutor);
    }
}
