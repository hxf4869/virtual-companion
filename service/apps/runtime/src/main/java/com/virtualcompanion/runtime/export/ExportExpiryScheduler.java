package com.virtualcompanion.runtime.export;

import com.virtualcompanion.platform.persistence.ExportService;
import com.virtualcompanion.platform.persistence.JobLease;
import com.virtualcompanion.runtime.observability.AlertNotifier;
import com.virtualcompanion.runtime.observability.AlertSeverity;
import java.util.OptionalLong;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * DATA-EXPORT expiry sweep (FR-DATA-002 过期后自动删除).
 *
 * <p>READY exports past their download expiry are terminalized as
 * {@code EXPIRED} with the payload and one-time token purged by
 * {@code vc.expire_stale_exports}. Inline mode (the default) is done then:
 * purging the payload column IS the Alpha realization of deleting the
 * object-storage file. A sweep failure records a FAILED run, emits fixed P1
 * {@code EXPORT_EXPIRY_FAILED}, and retries on the next cadence.
 *
 * <p>Object mode (DOGFOOD-02, ADR-0006 §7.3): when an
 * {@link ExportObjectStorage} is wired the sweep continues with a second
 * pass — every EXPIRED row that still carries an object pointer
 * ({@code vc.list_expired_export_objects}) gets its bucket object deleted,
 * and only a successful deletion clears the pointer
 * ({@code vc.clear_export_object}). A failed deletion keeps the row listed
 * and emits P1 {@code EXPORT_OBJECT_DELETE_FAILED} (no user content); the
 * next cadence retries it.
 *
 * <p>The bean exists only while the auth datasource is enabled.
 */
public class ExportExpiryScheduler {

    private static final Logger log = LoggerFactory.getLogger(ExportExpiryScheduler.class);

    /** P1 alert code for a failed export-object deletion (sweep retry loop). */
    public static final String ALERT_OBJECT_DELETE_FAILED = "EXPORT_OBJECT_DELETE_FAILED";

    private final ExportService exportService;
    private final JobLease jobLease;
    private final AlertNotifier alertNotifier;
    private final ExportObjectStorage objectStorage;
    private final String holder = UUID.randomUUID().toString();

    public ExportExpiryScheduler(ExportService exportService) {
        this(exportService, null, null);
    }

    public ExportExpiryScheduler(ExportService exportService, JobLease jobLease) {
        this(exportService, jobLease, null);
    }

    public ExportExpiryScheduler(
            ExportService exportService,
            JobLease jobLease,
            AlertNotifier alertNotifier) {
        this(exportService, jobLease, alertNotifier, null);
    }

    /** Full constructor; {@code objectStorage} non-null enables object mode. */
    public ExportExpiryScheduler(
            ExportService exportService,
            JobLease jobLease,
            AlertNotifier alertNotifier,
            ExportObjectStorage objectStorage) {
        this.exportService = exportService;
        this.jobLease = jobLease;
        this.alertNotifier = alertNotifier;
        this.objectStorage = objectStorage;
    }

    /** One sweep. Runs on its own slow cadence — expiry is an hourly concern. */
    @Scheduled(fixedDelayString = "${virtual-companion.data-export.expiry-poll-delay-ms:60000}")
    public void sweepExpiredExports() {
        OptionalLong runId = jobLease == null
                ? OptionalLong.empty()
                : jobLease.beginExclusive(JobLease.EXPORT_EXPIRY, holder, 60);
        if (jobLease != null && runId.isEmpty()) {
            return;
        }
        try {
            int expired = exportService.expireStale();
            if (expired > 0) {
                log.info("data-export expiry sweep purged {} expired export(s)", expired);
            }
            int deleteFailures = objectStorage == null ? 0 : deleteTerminalObjects();
            if (runId.isPresent()) {
                // DOGFOOD-STABILIZATION audit: a run whose object deletions
                // failed (rows stay listed, retried next cadence) is NOT a
                // SUCCEEDED run — record FAILED with the partial counts.
                if (deleteFailures > 0) {
                    jobLease.finishRun(
                            runId.getAsLong(),
                            "FAILED",
                            "{\"expired\":" + expired + ",\"objectDeleteFailures\":"
                                    + deleteFailures + "}",
                            "object_delete_failed");
                } else {
                    jobLease.finishRun(
                            runId.getAsLong(),
                            "SUCCEEDED",
                            "{\"expired\":" + expired + ",\"objectDeleteFailures\":0}",
                            "");
                }
            }
        } catch (RuntimeException e) {
            log.error("data-export expiry sweep failed; will retry next run", e);
            if (alertNotifier != null) {
                alertNotifier.alert(
                        AlertSeverity.P1,
                        "EXPORT_EXPIRY_FAILED",
                        "data export expiry sweep failed");
            }
            if (runId.isPresent()) {
                jobLease.finishRun(runId.getAsLong(), "FAILED", "{}", "sweep_failed");
            }
        }
    }

    /**
     * Object-mode second pass over TERMINAL rows still carrying an object
     * pointer — EXPIRED rows (post-expiry cleanup) and FAILED rows (the
     * durable pointers kept by the worker's no-orphan protocol): delete the
     * bucket object, then clear the pointer. Failures alert (fixed message,
     * no user content) and leave the row listed so the next cadence retries.
     * Returns the number of failed deletions.
     */
    private int deleteTerminalObjects() {
        int failures = 0;
        failures += deleteObjects(exportService.listExpiredObjects());
        failures += deleteObjects(exportService.listFailedObjects());
        return failures;
    }

    private int deleteObjects(
            Iterable<ExportService.ExpiredExportObject> staleObjects) {
        int failures = 0;
        for (ExportService.ExpiredExportObject stale : staleObjects) {
            try {
                objectStorage.delete(stale.objectKey());
                exportService.clearObject(
                        stale.ownerUserId(), stale.exportId(), stale.objectKey());
            } catch (RuntimeException e) {
                failures++;
                log.error(
                        "export object deletion failed for export={} (will retry next sweep)",
                        stale.exportId(),
                        e);
                if (alertNotifier != null) {
                    alertNotifier.alert(
                            AlertSeverity.P1,
                            ALERT_OBJECT_DELETE_FAILED,
                            "export object deletion failed; sweep will retry");
                }
            }
        }
        return failures;
    }
}
