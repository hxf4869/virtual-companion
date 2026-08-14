package com.virtualcompanion.platform.persistence;

import java.util.Objects;

/**
 * One claimed work item returned by {@code vc.claim_work_items}.
 *
 * <p>The {@code payload} is opaque worker data the coordinator never reads
 * (column-level privilege excludes it for {@code vc_job_coordinator}). The
 * {@code claimToken} + {@code claimFence} pair must be presented explicitly to
 * renew, complete, fail or cancel the item (V28 per-item functions) and to the
 * {@code vc.assert_active_claim} business-write guard; a stale fence, expired
 * wall-clock lease, wrong token or missing context updates zero rows. The raw
 * token/fence live only in worker memory — never in logs or database audit
 * rows (only SHA-256 hashes are persisted by the attempt intent).</p>
 */
public record WorkItemClaim(
        long ownerUserId,
        long id,
        String kind,
        long refId,
        byte[] payload,
        String claimToken,
        String claimFence) {

    public WorkItemClaim {
        Objects.requireNonNull(kind, "kind must not be null");
        if (kind.isBlank()) {
            throw new IllegalArgumentException("kind must not be blank");
        }
        Objects.requireNonNull(claimToken, "claimToken must not be null");
        if (claimToken.isBlank()) {
            throw new IllegalArgumentException("claimToken must not be blank");
        }
        Objects.requireNonNull(claimFence, "claimFence must not be null");
        if (claimFence.isBlank()) {
            throw new IllegalArgumentException("claimFence must not be blank");
        }
    }
}
