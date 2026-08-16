package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import java.util.Map;

/**
 * Routes a claimed work item to the handler registered for its kind
 * (MEM-LOOP: GENERATION and MEMORY_EXTRACT). An unknown kind throws so the
 * worker's independent per-item fail terminalizes it — a misrouted item must
 * never loop through the claim / lease-recovery cycle forever.
 */
public class DispatchingWorkItemHandler implements WorkItemHandler {

    private final Map<String, WorkItemHandler> handlers;

    public DispatchingWorkItemHandler(Map<String, WorkItemHandler> handlers) {
        this.handlers = Map.copyOf(handlers);
    }

    @Override
    public void handle(WorkItemClaim claim) {
        WorkItemHandler handler = handlers.get(claim.kind());
        if (handler == null) {
            throw new IllegalStateException("no handler for work item kind " + claim.kind());
        }
        handler.handle(claim);
    }
}
