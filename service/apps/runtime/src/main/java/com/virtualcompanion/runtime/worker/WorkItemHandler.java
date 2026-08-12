package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.WorkItemClaim;

/**
 * Processes one claimed work item inside the worker's single-transaction batch.
 *
 * <p>The handler runs within {@code OwnerContext#asOwner} (server-trusted owner
 * context) and inside the same transaction that claimed the item, so every
 * terminal write (complete/fail) still sees the transaction-local
 * {@code vc.owner_user_id} + {@code vc.job_fence} context required by the
 * claim family of SECURITY DEFINER functions (INV-WORKER-001).
 */
@FunctionalInterface
public interface WorkItemHandler {

    /**
     * Handle {@code claim}. An exception fails the item (status FAILED); the
     * worker never retries a late write.
     */
    void handle(WorkItemClaim claim);
}
