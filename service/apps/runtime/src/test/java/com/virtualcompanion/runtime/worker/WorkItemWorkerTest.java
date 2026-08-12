package com.virtualcompanion.runtime.worker;

import static org.junit.jupiter.api.Assertions.assertEquals;
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
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link WorkItemWorker}: the worker batch must run inside the
 * owner-bound executor ({@code OwnerContext#asOwner} at assembly) and
 * terminalize the batch exactly once through its shared token; a {@code 0}
 * terminal result is a rejected late write and is never retried
 * (INV-WORKER-001 fail-closed).
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
        return new WorkItemClaim(7L, id, "GENERATION", id * 10, null, "batch-tok");
    }

    @Test
    void processesEveryClaimInsideOwnerExecutorAndCompletesBatchOnce() {
        runAsOwnerSynchronously();
        List<WorkItemClaim> claims = List.of(claim(1L), claim(2L));
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(claims);
        when(claimService.complete("batch-tok")).thenReturn(2);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(2, processed);
        verify(ownerExecutor).asOwner(eq(7L), any(Runnable.class));
        verify(handler).handle(claims.get(0));
        verify(handler).handle(claims.get(1));
        verify(claimService, times(1)).complete("batch-tok"); // one batch-level write
        verify(claimService, never()).fail(any());
    }

    @Test
    void anyHandlerFailureFailsTheWholeBatchAndIsNotCounted() {
        runAsOwnerSynchronously();
        List<WorkItemClaim> claims = List.of(claim(1L), claim(2L));
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(claims);
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(claims.get(1));
        when(claimService.fail("batch-tok")).thenReturn(2);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(handler).handle(claims.get(0));
        verify(handler).handle(claims.get(1));
        verify(claimService, never()).complete(any());
        verify(claimService, times(1)).fail("batch-tok");
    }

    @Test
    void completeZeroRowsIsRejectedLateWriteNeverRetried() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(claim(1L)));
        when(claimService.complete("batch-tok")).thenReturn(0);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(claimService, times(1)).complete("batch-tok"); // no retry
        verify(claimService, never()).fail(any());
    }

    @Test
    void failZeroRowsIsNotCountedAndDoesNotThrow() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(claim(1L)));
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(any());
        when(claimService.fail("batch-tok")).thenReturn(0);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(claimService).fail("batch-tok");
    }

    @Test
    void emptyClaimBatchReturnsZeroWithoutHandling() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of());

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerExecutor, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(handler, never()).handle(any());
        verify(claimService, never()).complete(any());
        verify(claimService, never()).fail(any());
    }
}
