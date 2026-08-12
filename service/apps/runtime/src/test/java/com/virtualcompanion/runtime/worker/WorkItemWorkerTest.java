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
import com.virtualcompanion.runtime.auth.tenant.OwnerContext;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link WorkItemWorker}: the worker batch must run inside
 * {@code OwnerContext#asOwner(ownerUserId, ...)} and terminalize every claim
 * exactly once; a {@code 0} terminal result is a rejected late write and is
 * never retried (INV-WORKER-001 fail-closed).
 */
class WorkItemWorkerTest {

    private final WorkItemClaimService claimService = mock(WorkItemClaimService.class);
    private final OwnerContext ownerContext = mock(OwnerContext.class);
    private final WorkItemHandler handler = mock(WorkItemHandler.class);

    /** Run the Runnable argument of asOwner synchronously (mock has no transaction). */
    private void runAsOwnerSynchronously() {
        doAnswer(invocation -> {
            invocation.getArgument(1, Runnable.class).run();
            return null;
        }).when(ownerContext).asOwner(anyLong(), any(Runnable.class));
    }

    private WorkItemClaim claim(long id, String token) {
        return new WorkItemClaim(7L, id, "GENERATION", id * 10, null, token);
    }

    @Test
    void processesEveryClaimInsideAsOwnerAndCompletes() {
        runAsOwnerSynchronously();
        List<WorkItemClaim> claims = List.of(claim(1L, "tok-1"), claim(2L, "tok-2"));
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(claims);
        when(claimService.complete("tok-1")).thenReturn(1);
        when(claimService.complete("tok-2")).thenReturn(1);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerContext, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(2, processed);
        verify(ownerContext).asOwner(eq(7L), any(Runnable.class));
        verify(handler).handle(claims.get(0));
        verify(handler).handle(claims.get(1));
        verify(claimService).complete("tok-1");
        verify(claimService).complete("tok-2");
    }

    @Test
    void handlerFailureFailsTheItemAndIsNotCounted() {
        runAsOwnerSynchronously();
        WorkItemClaim item = claim(1L, "tok-1");
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(item));
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(item);
        when(claimService.fail("tok-1")).thenReturn(1);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerContext, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(claimService, never()).complete("tok-1");
        verify(claimService).fail("tok-1");
    }

    @Test
    void completeZeroRowsIsRejectedLateWriteNeverRetried() {
        runAsOwnerSynchronously();
        WorkItemClaim item = claim(1L, "tok-1");
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(item));
        when(claimService.complete("tok-1")).thenReturn(0);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerContext, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(claimService, times(1)).complete("tok-1"); // no retry
        verify(claimService, never()).fail(any());
    }

    @Test
    void failZeroRowsIsNotCountedAndDoesNotThrow() {
        runAsOwnerSynchronously();
        WorkItemClaim item = claim(1L, "tok-1");
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of(item));
        doAnswer(invocation -> {
            throw new IllegalStateException("boom");
        }).when(handler).handle(item);
        when(claimService.fail("tok-1")).thenReturn(0);

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerContext, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(claimService).fail("tok-1");
    }

    @Test
    void emptyClaimBatchReturnsZeroWithoutHandling() {
        runAsOwnerSynchronously();
        when(claimService.claim(eq(7L), eq("FENCE-A"))).thenReturn(List.of());

        WorkItemWorker worker = new WorkItemWorker(claimService, ownerContext, handler);
        int processed = worker.processOwnerBatch(7L, "FENCE-A");

        assertEquals(0, processed);
        verify(handler, never()).handle(any());
        verify(claimService, never()).complete(any());
        verify(claimService, never()).fail(any());
    }
}
