package com.virtualcompanion.platform.persistence;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Worker claim/lease/fence service bound to the {@code vc.claim_work_items}
 * family of SECURITY DEFINER functions.
 *
 * <p>Every terminal call (complete/fail/cancel) and lease renewal returns the
 * number of rows actually written. A return of {@code 0} means the claim was
 * rejected: the token, the current fence, the wall-clock lease or the tenant
 * context did not all match. Callers must treat {@code 0} as fail-closed and
 * never retry a late write (INV-WORKER-001).</p>
 *
 * <p>TASK-0194: the per-item {@code ...PerItem} methods bind the explicit
 * {@code (workItemId, claimToken, claimFence)} triple and are the only
 * production terminalization/renewal entry points (per-item terminalize,
 * never shared-token batch pollution). The legacy token-only methods remain
 * for compatibility with the V5 shared-token contract.</p>
 */
public class WorkItemClaimService {

    private final JdbcTemplate jdbc;

    public WorkItemClaimService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** Default lease seconds applied when the caller omits an explicit lease. */
    public static final int DEFAULT_LEASE_SECONDS = 30;

    /** Default maximum items claimed per call. */
    public static final int DEFAULT_CLAIM_LIMIT = 16;

    /**
     * Atomically claim up to {@code limit} pending items for one owner under a
     * fresh {@code fence}. The function binds {@code vc.owner_user_id} and
     * {@code vc.job_fence} for the transaction and returns the claimed rows with
     * a shared opaque claim token and the explicit fence (V28).
     */
    public List<WorkItemClaim> claim(long ownerUserId, String fence) {
        return claim(ownerUserId, fence, DEFAULT_LEASE_SECONDS, DEFAULT_CLAIM_LIMIT);
    }

    public List<WorkItemClaim> claim(long ownerUserId, String fence, int leaseSeconds, int limit) {
        return jdbc.query(
                "SELECT owner_user_id, id, kind, ref_id, payload, claim_token, claim_fence "
                        + "FROM vc.claim_work_items(?, ?, ?, ?)",
                (rs, rowNum) -> new WorkItemClaim(
                        rs.getLong("owner_user_id"),
                        rs.getLong("id"),
                        rs.getString("kind"),
                        rs.getLong("ref_id"),
                        rs.getBytes("payload"),
                        rs.getString("claim_token"),
                        rs.getString("claim_fence")),
                ownerUserId,
                fence,
                leaseSeconds,
                limit);
    }

    /** Rows renewed (0 = stale fence / expired lease / wrong token / no context). */
    public int renewLease(String claimToken, int leaseSeconds) {
        Integer rows = jdbc.queryForObject(
                "SELECT vc.renew_lease(?, ?)",
                Integer.class,
                claimToken,
                leaseSeconds);
        return rows == null ? 0 : rows;
    }

    /** Rows completed (0 = rejected late write). */
    public int complete(String claimToken) {
        return terminalize("SELECT vc.complete_work_item(?)", claimToken);
    }

    /** Rows failed (0 = rejected late write). */
    public int fail(String claimToken) {
        return terminalize("SELECT vc.fail_work_item(?)", claimToken);
    }

    /** Rows cancelled (0 = rejected late write). */
    public int cancel(String claimToken) {
        return terminalize("SELECT vc.cancel_work_item(?)", claimToken);
    }

    /** Per-item renewal (V28): renews exactly the given item. */
    public int renewPerItem(long workItemId, String claimToken, String claimFence, int leaseSeconds) {
        Integer rows = jdbc.queryForObject(
                "SELECT vc.renew_lease(?, ?, ?, ?)",
                Integer.class,
                workItemId,
                claimToken,
                claimFence,
                leaseSeconds);
        return rows == null ? 0 : rows;
    }

    /** Per-item completion (V28): terminalizes exactly the given item. */
    public int completePerItem(long workItemId, String claimToken, String claimFence) {
        return terminalizePerItem("SELECT vc.complete_work_item(?, ?, ?)",
                workItemId, claimToken, claimFence);
    }

    /** Per-item failure (V28): terminalizes exactly the given item. */
    public int failPerItem(long workItemId, String claimToken, String claimFence) {
        return terminalizePerItem("SELECT vc.fail_work_item(?, ?, ?)",
                workItemId, claimToken, claimFence);
    }

    /** Per-item cancellation (V28): terminalizes exactly the given item. */
    public int cancelPerItem(long workItemId, String claimToken, String claimFence) {
        return terminalizePerItem("SELECT vc.cancel_work_item(?, ?, ?)",
                workItemId, claimToken, claimFence);
    }

    private int terminalize(String sql, String claimToken) {
        Integer rows = jdbc.queryForObject(sql, Integer.class, claimToken);
        return rows == null ? 0 : rows;
    }

    private int terminalizePerItem(String sql, long workItemId, String claimToken, String claimFence) {
        Integer rows = jdbc.queryForObject(
                sql, Integer.class, workItemId, claimToken, claimFence);
        return rows == null ? 0 : rows;
    }
}
