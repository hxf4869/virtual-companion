package com.virtualcompanion.platform.persistence;

import java.util.Objects;

/**
 * One claimed work item returned by {@code vc.claim_work_items}.
 *
 * <p>The {@code payload} is opaque worker data the coordinator never reads
 * (column-level privilege excludes it for {@code vc_job_coordinator}). The
 * {@code claimToken} must be presented with the live tenant context to renew,
 * complete, fail or cancel the item; a stale fence, expired lease, wrong token
 * or missing context updates zero rows.
 */
public record WorkItemClaim(
        long ownerUserId,
        long id,
        String kind,
        long refId,
        byte[] payload,
        String claimToken) {

    public WorkItemClaim {
        Objects.requireNonNull(kind, "kind must not be null");
        if (kind.isBlank()) {
            throw new IllegalArgumentException("kind must not be blank");
        }
        Objects.requireNonNull(claimToken, "claimToken must not be null");
        if (claimToken.isBlank()) {
            throw new IllegalArgumentException("claimToken must not be blank");
        }
    }
}
