package com.virtualcompanion.runtime.export;

import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import java.util.Optional;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * DOGFOOD-STABILIZATION-05: fenced periodic reclaim of abandoned export
 * uploads.
 *
 * <p>The 04-round sweep listed stale intents and deleted object-then-row with
 * no claim, lease or fencing — the independent acceptance showed a stale
 * snapshot could delete an object a worker had just sealed, two scheduler
 * instances could process the same intent, and a reclaim racing the worker's
 * own put could orphan the object. This scheduler now drives the V114
 * state-machine protocol and never acts on a listing alone:</p>
 *
 * <ol>
 *   <li><b>reclaim</b> — for every stale-listed OPEN intent, win the atomic
 *       single-row claim ({@code claim_export_upload_intent}). A lost claim
 *       (seal consumed the row, another instance claimed it, a pointer
 *       appeared since the listing) means SKIP the object entirely; only the
 *       claim winner deletes it. The row becomes a retained CLAIMED
 *       tombstone.</li>
 *   <li><b>tombstone re-sweep + retirement</b> — CLAIMED rows are re-listed
 *       later and their object deleted again (idempotent): a worker that had
 *       already recorded could still put after the first reclaim crashed —
 *       the tombstone keeps that late object discoverable and deletable.
 *       Once the claim window is past every legal late put, the export is
 *       terminal and no pointer references the key, the row itself is
 *       retired (06) — no tombstone is re-swept forever.</li>
 *   <li><b>prefix audit</b> — one cursor-advancing bounded page per pass:
 *       every listed object with NO database record at all (no pointer, no
 *       intent row) is deleted. After an account-deletion cascade a late
 *       worker's object has no record; this audit is what finally removes
 *       it.</li>
 * </ol>
 *
 * <p>Every database return value is checked — a 0-row claim/mark is a skip,
 * never a success; every failure leaves the work listed for the next cadence
 * (reentrant) and alerts P1 {@code EXPORT_OBJECT_ORPHAN_RISK} with fixed ids
 * only — never keys' claim-fence digests, secrets or user content.</p>
 */
public class ExportUploadReconciliationScheduler {

    private static final Logger log =
            LoggerFactory.getLogger(ExportUploadReconciliationScheduler.class);

    /** P1 when an object could neither be reclaimed nor confirmed gone. */
    public static final String ALERT_ORPHAN_RISK = "EXPORT_OBJECT_ORPHAN_RISK";

    /** Hard bound per run and phase (the SD clamps to the same value). */
    static final int MAX_PER_RUN = 100;

    /** Bound for the prefix-audit phase per run. */
    static final int MAX_AUDIT_PER_RUN = 200;

    /** Default grace before an intent is considered abandoned (15 min). */
    static final long DEFAULT_GRACE_MS = 15 * 60 * 1000L;

    /** Every export object lives under this prefix (V109 key layout). */
    static final String EXPORT_KEY_PREFIX = "exports/";

    private final ExportService exportService;
    private final ExportObjectStorage objectStorage;
    private final AlertNotifier alertNotifier;
    private final long graceMs;
    /**
     * 06: the prefix audit's forward cursor (last key of the previous page).
     * Each pass scans exactly ONE bounded page starting after it, so normal
     * objects count towards the bound and a full-bucket load is structurally
     * impossible; a null cursor restarts from the beginning of the prefix
     * after an exhausted listing. In-memory only — a restart re-walks the
     * prefix one bounded page per cadence, which is the same convergence.
     */
    private final java.util.concurrent.atomic.AtomicReference<String> auditCursor =
            new java.util.concurrent.atomic.AtomicReference<>();

    public ExportUploadReconciliationScheduler(
            ExportService exportService,
            ExportObjectStorage objectStorage,
            AlertNotifier alertNotifier) {
        this(exportService, objectStorage, alertNotifier, DEFAULT_GRACE_MS);
    }

    public ExportUploadReconciliationScheduler(
            ExportService exportService,
            ExportObjectStorage objectStorage,
            AlertNotifier alertNotifier,
            long graceMs) {
        this.exportService = exportService;
        this.objectStorage = objectStorage;
        this.alertNotifier = alertNotifier;
        if (graceMs < 0) {
            throw new IllegalArgumentException("graceMs must not be negative");
        }
        this.graceMs = graceMs;
    }

    /** One bounded reconciliation pass (5-minute cadence by default). */
    @Scheduled(fixedDelayString =
            "${virtual-companion.data-export.upload-reconcile-delay-ms:300000}")
    public void reconcileAbandonedUploads() {
        int failures = runOnce();
        if (failures > 0) {
            log.error("export upload reconciliation finished with {} failure(s); "
                    + "affected rows stay listed and retry next cadence", failures);
            if (alertNotifier != null) {
                alertNotifier.alert(
                        AlertSeverity.P1,
                        ALERT_ORPHAN_RISK,
                        "an abandoned export upload object could not be reclaimed; "
                                + "the sweep will retry (owner/export ids are in the server log; "
                                + "no keys or content in alerts)");
            }
        }
    }

    /**
     * One pass over the three phases. Package-visible for the
     * bounded/reentrant/fencing unit tests.
     *
     * @return the number of rows/objects that failed to reclaim
     */
    int runOnce() {
        int graceSeconds = (int) Math.min(graceMs / 1000L, Integer.MAX_VALUE);
        int failures = reclaimStaleIntents(graceSeconds);
        failures += resweepClaimedTombstones(graceSeconds);
        failures += auditUnrecordedObjects();
        return failures;
    }

    /**
     * Phase 1 — atomic reclaim. The stale listing is only a candidate set:
     * each row must still win the single-row claim, which (06) re-validates
     * the LIVE lease against this grace inside the same atomic statement — a
     * renew or re-record after the listing loses, and after a row-lock wait
     * the claim re-evaluates the latest lease. A lost claim skips the object
     * (it was sealed, consumed, claimed elsewhere, pointed at, re-leased, or
     * owned by a deleting account — never the sweeper's to touch).
     */
    private int reclaimStaleIntents(int graceSeconds) {
        int failures = 0;
        int reclaimed = 0;
        for (ExportService.StaleUploadIntent intent
                : exportService.staleUploadIntents(MAX_PER_RUN, graceSeconds)) {
            Optional<String> claimedKey;
            try {
                claimedKey = exportService.claimUploadIntent(
                        intent.ownerUserId(), intent.intentId(), graceSeconds);
            } catch (RuntimeException e) {
                failures++;
                logClaimFailure(intent, e);
                continue;
            }
            if (claimedKey.isEmpty()) {
                // Lost the claim — the object is not ours to touch.
                continue;
            }
            try {
                objectStorage.delete(claimedKey.get());
                reclaimed++;
            } catch (RuntimeException e) {
                // The row is already CLAIMED: the tombstone re-sweep below
                // retries the object delete on a later cadence.
                failures++;
                logClaimFailure(intent, e);
            }
        }
        if (reclaimed > 0) {
            log.info("export upload reconciliation reclaimed {} abandoned object(s)",
                    reclaimed);
        }
        return failures;
    }

    /**
     * Phase 2 — tombstone re-sweep and retirement. A worker that recorded
     * before the claim could still put afterwards and crash; the retained
     * CLAIMED row keeps that late object addressable. The re-delete is
     * idempotent. Once the provably-safe retirement conditions hold — the
     * claim window far past every legal late put (the storage call-timeout
     * bound, with the same grace applied by the SQL), the export terminal
     * and no pointer on the key — the row itself is deleted after this final
     * sweep, so no tombstone is re-swept forever.
     */
    private int resweepClaimedTombstones(int graceSeconds) {
        int failures = 0;
        for (ExportService.StaleUploadIntent intent
                : exportService.claimedUploadIntents(MAX_PER_RUN, graceSeconds)) {
            try {
                objectStorage.delete(intent.objectKey());
                if (exportService.retireUploadTombstone(
                        intent.ownerUserId(), intent.intentId(), graceSeconds) > 0) {
                    // Row retired after the final delete — nothing to mark.
                    continue;
                }
                exportService.markUploadIntentSwept(intent.ownerUserId(), intent.intentId());
            } catch (RuntimeException e) {
                failures++;
                logClaimFailure(intent, e);
            }
        }
        return failures;
    }

    /**
     * Phase 3 — prefix audit: the bounded final convergence, gated by the
     * DURABLE reclaim fence (07, defect D). One cursor-advancing page per
     * pass: at most {@link #MAX_AUDIT_PER_RUN} keys are listed (normal
     * objects count towards the bound). For each key with no database
     * record at all (no pointer, no intent row — the candidate pre-filter),
     * the audit holds the key's RECLAIM fence BEFORE deleting: a worker
     * recording the same key concurrently loses on the fence's unique row
     * and is refused BEFORE its put, and a record that committed first
     * makes the fence lose instead (the object is not the audit's to
     * delete) — a READY pointer can never reference a deleted object. The
     * fence is released after the delete finished, success or not; the
     * cursor makes the walk resume where the last pass stopped.
     */
    private int auditUnrecordedObjects() {
        int failures = 0;
        String cursor = auditCursor.get();
        ExportObjectStorage.ObjectListing page;
        try {
            page = objectStorage.listPage(
                    EXPORT_KEY_PREFIX, cursor == null || cursor.isBlank() ? null : cursor,
                    MAX_AUDIT_PER_RUN);
        } catch (RuntimeException e) {
            log.error("export prefix audit could not list one page under the export prefix",
                    e);
            return 1;
        }
        for (String key : page.keys()) {
            boolean fenced = false;
            try {
                if (exportService.objectHasRecord(key)) {
                    continue;
                }
                if (!exportService.fenceOrphanReclaim(key)) {
                    // A live WRITER holds the key, or the fence's atomic
                    // re-validation found a durable record — never the
                    // audit's to touch. An existing RECLAIM does NOT refuse:
                    // the fence re-arms, so another audit pass (or a later
                    // cadence of this one) re-holds the same key and the
                    // repeated delete of the same old key is idempotent —
                    // the fence row provides safety (no unrecorded object
                    // survives, no recorded object is deleted), NOT a
                    // single winner among concurrent audits. A NEW upload
                    // claim never contends here either: it carries a fresh
                    // claimFence and therefore a different object key.
                    continue;
                }
                fenced = true;
                objectStorage.delete(key);
                log.warn("export prefix audit removed an unrecorded object");
            } catch (RuntimeException e) {
                failures++;
                log.error("export prefix audit failed to reconcile one object", e);
            } finally {
                if (fenced) {
                    try {
                        exportService.clearOrphanReclaim(key);
                    } catch (RuntimeException e) {
                        failures++;
                        log.error("export prefix audit could not release its reclaim fence", e);
                    }
                }
            }
        }
        // Advance (or reset) the cursor AFTER the pass: an exhausted page
        // (fewer keys than the bound) restarts the next pass at the prefix
        // head, a full page resumes strictly after its last key.
        auditCursor.set(page.nextCursor());
        return failures;
    }

    private void logClaimFailure(ExportService.StaleUploadIntent intent, RuntimeException e) {
        // Fixed ids only — the key embeds a claim-fence digest, and no user
        // content ever exists in an intent row.
        log.error(
                "export upload reclaim failed (owner={} export={} intentId={}); "
                        + "row stays listed for the next cadence",
                intent.ownerUserId(),
                intent.exportId(),
                intent.intentId(),
                e);
    }
}
