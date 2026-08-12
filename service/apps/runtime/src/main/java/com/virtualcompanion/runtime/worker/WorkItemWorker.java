package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import com.virtualcompanion.platform.persistence.WorkItemClaimService;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * P1-04 worker execution half (Owner 2026-08-12 decisions: server-side owner
 * injection, runtime in-process). Processes a batch of pending work items for
 * one owner inside a single owner-bound transaction: claim -> handle each ->
 * one batch-level terminal write.
 *
 * <p>The single-transaction shape is required by V5: the claim family of
 * SECURITY DEFINER functions bind the tenant context through transaction-local
 * GUCs ({@code vc.owner_user_id} + {@code vc.job_fence}); a terminal write
 * outside the claiming transaction loses the context and updates zero rows.
 * One {@code claim_work_items} call issues one opaque token shared by the whole
 * batch, so terminalization is batch-level: all handlers succeeded ->
 * {@code complete(token)} (rows = batch size), any handler failure ->
 * {@code fail(token)} (the batch gets a FAILED terminal state instead of
 * looping back into PENDING). A {@code 0} return means the batch was rejected
 * (stale fence, expired lease, wrong token, missing context) and is never
 * retried (INV-WORKER-001 fail-closed).
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
     * @return number of items terminalized to DONE (all handlers succeeded);
     *     a FAILED batch or a rejected late write yields {@code 0}
     */
    public int processOwnerBatch(long ownerUserId, String fence) {
        final int[] processed = {0};
        ownerExecutor.asOwner(ownerUserId, () -> {
            List<WorkItemClaim> claims = claimService.claim(ownerUserId, fence);
            if (claims.isEmpty()) {
                return;
            }
            boolean allSucceeded = true;
            for (WorkItemClaim claim : claims) {
                try {
                    handler.handle(claim);
                } catch (RuntimeException e) {
                    allSucceeded = false;
                }
            }
            String token = claims.get(0).claimToken();
            if (allSucceeded) {
                processed[0] = terminalize(claimService.complete(token), token, "complete");
            } else {
                terminalize(claimService.fail(token), token, "fail");
            }
        });
        return processed[0];
    }

    private int terminalize(int rows, String token, String action) {
        if (rows == 0) {
            log.warn(
                    "work item batch token={} {} rejected "
                            + "(stale fence / expired lease / wrong token / missing context); not retried",
                    token,
                    action);
            return 0;
        }
        return rows;
    }
}
