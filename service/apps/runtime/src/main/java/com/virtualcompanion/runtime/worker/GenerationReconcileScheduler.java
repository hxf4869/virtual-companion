package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.GenerationFinalizeService;
import com.virtualcompanion.platform.persistence.GenerationFinalizeService.StaleGenerationRow;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * GEN-RECONC: periodic reconciliation of generations stuck {@code IN_PROGRESS}
 * whose work item is already terminal (V33
 * {@code vc.list_stale_in_progress_generations}).
 *
 * <p>Before V33 two paths could leave such an orphan: a retried run whose
 * prepare segment hit the illegal {@code IN_PROGRESS → IN_PROGRESS} promotion,
 * or any handler exception that routed through the worker's independent
 * per-item fail (only the work item was terminalized). Both left the client's
 * SSE stream open forever because non-terminal generations never deliver a
 * durable terminal event. The reconcile poll terminalizes each orphan as
 * {@code FAILED_FINAL} with a {@code chat.failed} event via the existing
 * {@code terminalize_generation} (V15), so every stream eventually closes with
 * a durable terminal event.
 *
 * <p>One row's failure is logged and does not block the rest; a poll-wide
 * failure is logged so the next scheduled round still runs (same resilience
 * shape as {@link WorkItemCoordinator}). Logs carry only owner ids and
 * generation ids — never business content.
 */
public class GenerationReconcileScheduler {

    private static final Logger log = LoggerFactory.getLogger(GenerationReconcileScheduler.class);

    /** Fault string surfaced to the client via the chat.failed payload. */
    static final String FAULT_RECONCILE_STALE = "reconcile-stale-in-progress";

    private final GenerationFinalizeService finalizeService;

    public GenerationReconcileScheduler(GenerationFinalizeService finalizeService) {
        this.finalizeService = finalizeService;
    }

    /**
     * One reconcile poll. Runs on its own cadence (independent of the 5s claim
     * coordinator poll) because orphaned generations appear only after the
     * worker's independent-fail path or a dead-letter/cancel race, both rare.
     */
    @Scheduled(fixedDelayString = "${virtual-companion.worker.reconcile-poll-delay-ms:30000}")
    public void reconcileStaleGenerations() {
        try {
            List<StaleGenerationRow> stale = finalizeService.listStaleInProgressGenerations();
            if (stale.isEmpty()) {
                return;
            }
            for (StaleGenerationRow row : stale) {
                try {
                    finalizeService.terminalizeAsFailed(
                            row.ownerUserId(), row.generationId(), FAULT_RECONCILE_STALE);
                    log.warn(
                            "reconciled stale IN_PROGRESS generation {} for owner {} as FAILED_FINAL",
                            row.generationId(),
                            row.ownerUserId());
                } catch (RuntimeException e) {
                    // One row's failure must not block the remaining rows.
                    log.error(
                            "generation reconciliation failed for owner={} generation={}",
                            row.ownerUserId(),
                            row.generationId(),
                            e);
                }
            }
        } catch (RuntimeException e) {
            // A poll-wide failure is logged so the next scheduled round still
            // runs; the reconciler never escalates out of the scheduler.
            log.error("generation reconciliation poll failed; will retry next run", e);
        }
    }
}
