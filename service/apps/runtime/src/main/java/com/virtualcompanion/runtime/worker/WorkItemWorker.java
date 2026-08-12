package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * P1-04 worker execution half (Owner 2026-08-12 decisions: server-side owner
 * injection, runtime in-process). Processes a batch of pending work items for
 * one owner inside a single owner-bound transaction: claim -> handle ->
 * complete/fail.
 *
 * <p>The single-transaction shape is required by V5: the claim family of
 * SECURITY DEFINER functions bind the tenant context through transaction-local
 * GUCs ({@code vc.owner_user_id} + {@code vc.job_fence}); a terminal write
 * outside the claiming transaction loses the context and updates zero rows. A
 * {@code 0} return therefore means the claim was rejected (stale fence,
 * expired lease, wrong token, missing context) and is never retried
 * (INV-WORKER-001 fail-closed). Handler failures terminalize to FAILED so the
 * item does not loop back into PENDING indefinitely.
 *
 * <p>No polling schedule here: deciding which owner's queue to process and
 * issuing fences is coordinator responsibility (§5.1.2, OWNER_GATE).
 *
 * <p>The server-trusted owner-context executor is injected as the narrow
 * {@link OwnerExecutor} port and wired to
 * {@code OwnerContext#asOwner} at assembly time (module-boundary clean).
 */
public class WorkItemWorker {

    private static final Logger log = LoggerFactory.getLogger(WorkItemWorker.class);

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
     * under {@code fence} and process them inside one owner-bound transaction.
     *
     * @return number of items terminalized to DONE (handler success); items
     *     terminalized to FAILED or rejected late writes are not counted
     */
    public int processOwnerBatch(long ownerUserId, String fence) {
        final int[] processed = {0};
        ownerExecutor.asOwner(ownerUserId, () -> {
            List<WorkItemClaim> claims = claimService.claim(ownerUserId, fence);
            for (WorkItemClaim claim : claims) {
                processed[0] += handleOne(claim);
            }
        });
        return processed[0];
    }

    private int handleOne(WorkItemClaim claim) {
        try {
            handler.handle(claim);
            return terminalize(claimService.complete(claim.claimToken()), claim, "complete");
        } catch (RuntimeException e) {
            terminalize(claimService.fail(claim.claimToken()), claim, "fail");
            return 0;
        }
    }

    private int terminalize(int rows, WorkItemClaim claim, String action) {
        if (rows == 0) {
            log.warn(
                    "work item id={} {} rejected "
                            + "(stale fence / expired lease / wrong token / missing context); not retried",
                    claim.id(),
                    action);
            return 0;
        }
        return rows;
    }
}
