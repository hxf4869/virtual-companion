package com.virtualcompanion.runtime.worker;

import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * §5.1.2 worker claim coordinator (TASK-0173): runtime in-process
 * {@code @Scheduled} polling that decides which owner's queue to process and
 * issues the claim fences the worker executes under.
 *
 * <p>Each poll run: ① recovers claims whose lease expired (crashed or stuck
 * workers release their CLAIMED items back to PENDING via
 * {@code vc.recover_expired_claims}); ② enumerates the owners that still have
 * PENDING items ({@code vc.list_pending_owner_ids} -- the runtime pool role
 * {@code vc_api} has no table-level SELECT on {@code work_item}, so the
 * coordinator reaches the queue only through these V24 SECURITY DEFINER
 * functions); ③ for every such owner issues a fresh fence (UUID) and runs one
 * owner-bound worker batch ({@link WorkItemWorker#processOwnerBatch}). Fence
 * issuance is the coordinator's allocation act: the worker never picks a fence
 * itself, and a stale fence from an earlier round is rejected by V5's guards
 * (test 64).
 *
 * <p>Failure semantics: one owner's batch failure is logged and does not block
 * the remaining owners; a poll-wide exception is caught and logged so the
 * single-threaded {@code @Scheduled} loop survives into the next run (no
 * silent stall). V29 RETRY-A adds bounded retry of adapter-classified
 * RETRYABLE_FAILED outcomes and a DEAD_LETTERED terminal state — the
 * coordinator itself only observes them via {@code list_pending_owner_ids}
 * (backoff windows hide not-yet-due items). Logs carry only owner ids and
 * counts, never the claim token, fence or work payload.
 *
 * <p>The bean is registered by {@code AuthDataSourceConfig} only while the
 * auth datasource is enabled, and {@code @EnableScheduling} on the same
 * conditional configuration activates Spring's scheduler solely in that state
 * -- there is no polling without a live database.
 */
public class WorkItemCoordinator {

    private static final Logger log = LoggerFactory.getLogger(WorkItemCoordinator.class);

    static final String RECOVER_SQL = "SELECT vc.recover_expired_claims(0)";
    static final String LIST_PENDING_OWNERS_SQL =
            "SELECT owner_user_id FROM vc.list_pending_owner_ids()";

    private final WorkItemWorker workItemWorker;
    private final JdbcTemplate authJdbcTemplate;

    public WorkItemCoordinator(WorkItemWorker workItemWorker, JdbcTemplate authJdbcTemplate) {
        this.workItemWorker = workItemWorker;
        this.authJdbcTemplate = authJdbcTemplate;
    }

    /**
     * One poll round. Recovery runs first so a crashed worker's expired lease
     * releases its items back to PENDING before the queue is enumerated; each
     * owner then gets a fresh fence and one worker batch inside its own
     * owner-bound transaction (claim semantics stay single-owner, INV-TENANT-001).
     */
    @Scheduled(fixedDelayString = "${virtual-companion.worker.coordinator-poll-delay-ms:5000}")
    public void pollOwnerQueues() {
        try {
            int recovered = recoverExpiredClaims();
            if (recovered > 0) {
                log.info("work coordinator recovered {} expired claim(s)", recovered);
            }
            List<Long> ownerIds = listPendingOwnerIds();
            for (long ownerUserId : ownerIds) {
                try {
                    int processed = workItemWorker.processOwnerBatch(
                            ownerUserId, UUID.randomUUID().toString());
                    log.info(
                            "work coordinator processed {} item(s) for owner {}",
                            processed,
                            ownerUserId);
                } catch (RuntimeException e) {
                    // One owner's batch failure must not stall the rest of the
                    // round nor kill the scheduled loop.
                    log.error(
                            "work coordinator batch failed for owner {}; continuing next owner",
                            ownerUserId,
                            e);
                }
            }
        } catch (RuntimeException e) {
            // A poll-wide failure is logged so the next scheduled round still
            // runs; the coordinator never escalates out of the scheduler.
            log.error("work coordinator poll failed; will retry next run", e);
        }
    }

    int recoverExpiredClaims() {
        Integer recovered = authJdbcTemplate.queryForObject(
                RECOVER_SQL, Integer.class);
        return recovered == null ? 0 : recovered;
    }

    List<Long> listPendingOwnerIds() {
        return authJdbcTemplate.query(
                LIST_PENDING_OWNERS_SQL,
                (rs, rowNum) -> rs.getLong("owner_user_id"));
    }
}
