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
 * {@code vc.expire_stale_exports}. Technical Alpha stores the document inline
 * (no object storage), so purging the payload column is the Alpha realization
 * of deleting the object-storage file. A sweep failure records a FAILED run,
 * emits fixed P1 {@code EXPORT_EXPIRY_FAILED}, and retries on the next cadence.
 * The bean exists only while the auth datasource is enabled.
 */
public class ExportExpiryScheduler {

    private static final Logger log = LoggerFactory.getLogger(ExportExpiryScheduler.class);

    private final ExportService exportService;
    private final JobLease jobLease;
    private final AlertNotifier alertNotifier;
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
        this.exportService = exportService;
        this.jobLease = jobLease;
        this.alertNotifier = alertNotifier;
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
            if (runId.isPresent()) {
                jobLease.finishRun(runId.getAsLong(), "SUCCEEDED", "{\"expired\":" + expired + "}", "");
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
}
