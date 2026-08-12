package com.virtualcompanion.runtime.worker;

import com.virtualcompanion.platform.persistence.WorkItemClaim;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Default {@link WorkItemHandler}: logs claim metadata only. The opaque
 * {@code payload} is never read or logged (no PII, no business content); real
 * business handlers arrive with the coordinator work (OWNER_GATE).
 */
public final class LoggingWorkItemHandler implements WorkItemHandler {

    private static final Logger log = LoggerFactory.getLogger(LoggingWorkItemHandler.class);

    @Override
    public void handle(WorkItemClaim claim) {
        log.info(
                "work item id={} kind={} refId={} processed",
                claim.id(),
                claim.kind(),
                claim.refId());
    }
}
