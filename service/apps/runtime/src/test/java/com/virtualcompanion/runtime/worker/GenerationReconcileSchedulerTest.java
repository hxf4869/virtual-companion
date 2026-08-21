package com.virtualcompanion.runtime.worker;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService.StaleGenerationRow;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * GEN-RECONC: unit tests for {@link GenerationReconcileScheduler} (V33
 * {@code vc.list_stale_in_progress_generations} + terminalize-as-failed
 * reconciliation). Verifies: an empty enumeration is a no-op; every orphan is
 * terminalized FAILED_FINAL with the reconcile fault string; one row's failure
 * does not block the remaining rows; a poll-wide failure is swallowed so the
 * scheduled loop survives.
 */
class GenerationReconcileSchedulerTest {

    private final GenerationFinalizeService finalizeService = mock(GenerationFinalizeService.class);
    private final WorkItemWorker.OwnerExecutor ownerExecutor = mock(WorkItemWorker.OwnerExecutor.class);
    private GenerationReconcileScheduler scheduler;

    @BeforeEach
    void setUp() {
        scheduler = new GenerationReconcileScheduler(finalizeService, ownerExecutor);
        // V27 owner-bound: the mock executes the runnable synchronously, as the
        // production OwnerContext does inside its transaction.
        doAnswer(invocation -> {
            ((Runnable) invocation.getArgument(1)).run();
            return null;
        }).when(ownerExecutor).asOwner(anyLong(), any(Runnable.class));
    }

    @Test
    void emptyEnumerationIsANoOp() {
        when(finalizeService.listStaleInProgressGenerations()).thenReturn(List.of());

        scheduler.reconcileStaleGenerations();

        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), eq(
                GenerationReconcileScheduler.FAULT_RECONCILE_STALE));
    }

    @Test
    void terminalizesEveryOrphanAsFailedWithTheReconcileFault() {
        when(finalizeService.listStaleInProgressGenerations()).thenReturn(List.of(
                new StaleGenerationRow(1L, 10L),
                new StaleGenerationRow(1L, 11L),
                new StaleGenerationRow(2L, 20L)));

        scheduler.reconcileStaleGenerations();

        verify(finalizeService).terminalizeAsFailed(
                1L, 10L, GenerationReconcileScheduler.FAULT_RECONCILE_STALE);
        verify(finalizeService).terminalizeAsFailed(
                1L, 11L, GenerationReconcileScheduler.FAULT_RECONCILE_STALE);
        verify(finalizeService).terminalizeAsFailed(
                2L, 20L, GenerationReconcileScheduler.FAULT_RECONCILE_STALE);
        // Every terminalize runs inside the owner-bound executor (V27): the SD
        // reject a principal without the server-trusted owner context.
        verify(ownerExecutor, org.mockito.Mockito.times(3))
                .asOwner(anyLong(), any(Runnable.class));
    }

    @Test
    void oneRowsFailureDoesNotBlockTheRemainingRows() {
        when(finalizeService.listStaleInProgressGenerations()).thenReturn(List.of(
                new StaleGenerationRow(1L, 10L),
                new StaleGenerationRow(1L, 11L)));
        doThrow(new IllegalStateException("row failure"))
                .when(finalizeService)
                .terminalizeAsFailed(1L, 10L, GenerationReconcileScheduler.FAULT_RECONCILE_STALE);

        scheduler.reconcileStaleGenerations();

        verify(finalizeService).terminalizeAsFailed(
                1L, 10L, GenerationReconcileScheduler.FAULT_RECONCILE_STALE);
        verify(finalizeService).terminalizeAsFailed(
                1L, 11L, GenerationReconcileScheduler.FAULT_RECONCILE_STALE);
    }

    @Test
    void pollWideFailureIsSwallowed() {
        when(finalizeService.listStaleInProgressGenerations())
                .thenThrow(new IllegalStateException("db down"));

        scheduler.reconcileStaleGenerations();

        verify(finalizeService, never()).terminalizeAsFailed(anyLong(), anyLong(), eq(
                GenerationReconcileScheduler.FAULT_RECONCILE_STALE));
    }

    @Test
    void faultStringIsStableAndDescriptive() {
        assertThat(GenerationReconcileScheduler.FAULT_RECONCILE_STALE)
                .isEqualTo("reconcile-stale-in-progress");
    }
}
