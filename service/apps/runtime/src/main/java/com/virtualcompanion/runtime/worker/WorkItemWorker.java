package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * P1-04 worker execution half (Owner 2026-08-12 decisions: server-side owner
 * injection, runtime in-process). Processes a batch of pending work items for
 * one owner.
 *
 * <p>TASK-0194 segmented transaction model: the worker no longer holds one
 * long owner transaction across claim + provider call + finalize. Each segment
 * is its own short owner-bound transaction:
 * <ol>
 *   <li><b>claim-tx</b>: {@code vc.claim_work_items} claims the batch and
 *       commits immediately, releasing the row locks and returning the explicit
 *       token/fence pair per item (V28);</li>
 *   <li><b>handler segments</b>: the handler runs prepare-tx / external-no-db /
 *       audit-outcome-tx / guarded-finalize-tx (or guarded-fail-tx) per item —
 *       the external network phase executes with no database transaction and no
 *       claim row lock;</li>
 *   <li><b>independent-fail-tx</b>: when an item's handler throws, a FRESH
 *       transaction per-item fails ONLY the original
 *       {@code (work_item_id, claim_token, claim_fence)} — it can never touch a
 *       takeover claim held by a new worker (V28 per-item fail).</li>
 * </ol>
 * A per-item {@code 0} terminal result means the claim was rejected (stale
 * fence, wall-clock-expired lease, wrong token/fence, missing context) and is
 * never retried (INV-WORKER-001 fail-closed). Logs carry only owner ids and
 * item ids — never the claim token or fence.
 *
 * <p>No polling schedule here: deciding which owner's queue to process and
 * issuing fences is coordinator responsibility (§5.1.2, OWNER_GATE).
 *
 * <p>The server-trusted owner-context executor is injected as the narrow
 * {@link OwnerExecutor} port and wired to
 * {@code OwnerContext#asOwner} at assembly time (module-boundary clean). The
 * handler runs inside {@link #processOwnerBatch} with the same executor
 * installed on a thread-local segment channel ({@link #segmentExecutor()});
 * this is a context-propagation channel, not a second execution model — the
 * handler cannot be invoked outside a worker batch.</p>
 */
public class WorkItemWorker {

    private static final Logger log = LoggerFactory.getLogger(WorkItemWorker.class);

    /**
     * Segment-executor channel for handlers of the current batch. The worker
     * installs its own {@link OwnerExecutor} around every
     * {@code handler.handle} call so the handler can run its short segmented
     * owner-bound transactions without a second wiring path (the runtime bean
     * wiring is frozen by the task context).
     */
    private static final ThreadLocal<OwnerExecutor> SEGMENT_EXECUTOR = new ThreadLocal<>();

    /**
     * Runs a unit of work bound to one owner (server-trusted). Implemented by
     * {@code OwnerContext#asOwner} at assembly time.
     */
    @FunctionalInterface
    public interface OwnerExecutor {
        void asOwner(long ownerUserId, Runnable work);
    }

    private final WorkItemClaimService claimService;
    private final OwnerExecutor ownerExecutor;
    private final WorkItemHandler handler;

    public WorkItemWorker(
            WorkItemClaimService claimService,
            OwnerExecutor ownerExecutor,
            WorkItemHandler handler) {
        this.claimService = claimService;
        this.ownerExecutor = ownerExecutor;
        this.handler = handler;
    }

    /**
     * Claim up to the default limit of pending items for {@code ownerUserId}
     * under {@code fence} and process them in segmented owner-bound
     * transactions.
     *
     * @return number of items terminalized to DONE (handlers that completed);
     *     items whose handler failed are independently failed per item and
     *     never counted
     */
    public int processOwnerBatch(long ownerUserId, String fence) {
        final List<WorkItemClaim> claims;
        try {
            claims = claim(ownerUserId, fence);
        } catch (RuntimeException e) {
            log.error("work claim failed for owner {}; skipping batch", ownerUserId, e);
            return 0;
        }
        if (claims.isEmpty()) {
            return 0;
        }
        int done = 0;
        try {
            done = withSegmentExecutor(ownerExecutor, () -> {
                int completed = 0;
                for (WorkItemClaim claim : claims) {
                    try {
                        handler.handle(claim);
                        completed++;
                    } catch (RuntimeException e) {
                        // The item's own segments failed (possibly a permanent DB
                        // error inside the guarded finalize transaction). Fail ONLY
                        // this original item/token/fence in a fresh transaction so
                        // the failure is terminal on disk and the coordinator never
                        // re-claims it (no 5-second hot loop). A takeover claim by a
                        // new worker is never touched (token/fence mismatch → 0).
                        log.error(
                                "work item {} failed for owner {}; applying independent per-item fail",
                                claim.id(),
                                ownerUserId,
                                e);
                        independentFail(ownerUserId, claim);
                    }
                }
                return completed;
            });
        } finally {
            // no-op: withSegmentExecutor restored the channel
        }
        return done;
    }

    /**
     * Run {@code work} with {@code executor} installed on the segment-executor
     * channel, restoring the previous holder afterwards. The worker batch loop
     * uses this for every handler call; tests use it to drive a handler exactly
     * like the batch loop does.
     */
    static <T> T withSegmentExecutor(OwnerExecutor executor, java.util.function.Supplier<T> work) {
        OwnerExecutor previous = SEGMENT_EXECUTOR.get();
        SEGMENT_EXECUTOR.set(executor);
        try {
            return work.get();
        } finally {
            if (previous == null) {
                SEGMENT_EXECUTOR.remove();
            } else {
                SEGMENT_EXECUTOR.set(previous);
            }
        }
    }

    /**
     * The segment executor installed by the running worker batch. Handlers use
     * it to run their short owner-bound transactions; there is no executor
     * outside a worker batch (fail closed).
     */
    static OwnerExecutor segmentExecutor() {
        OwnerExecutor executor = SEGMENT_EXECUTOR.get();
        if (executor == null) {
            throw new IllegalStateException(
                    "no worker segment executor installed; handlers only run inside WorkItemWorker.processOwnerBatch");
        }
        return executor;
    }

    private List<WorkItemClaim> claim(long ownerUserId, String fence) {
        final List<WorkItemClaim>[] result = new List[1];
        ownerExecutor.asOwner(ownerUserId, () ->
                result[0] = claimService.claim(ownerUserId, fence));
        return result[0];
    }

    private void independentFail(long ownerUserId, WorkItemClaim claim) {
        try {
            ownerExecutor.asOwner(ownerUserId, () -> {
                int rows = claimService.failPerItem(
                        claim.id(), claim.claimToken(), claim.claimFence());
                if (rows == 0) {
                    // Already terminal, or the claim was taken over by a new
                    // worker (token/fence mismatch): nothing to do, and the
                    // new claim must never be harmed.
                    log.warn(
                            "independent fail rejected for work item {} (claim already terminal or overtaken); not retried",
                            claim.id());
                }
            });
        } catch (RuntimeException suppressed) {
            log.error(
                    "independent fail transaction also failed for work item {}; item left for lease recovery",
                    claim.id(),
                    suppressed);
        }
    }
}
