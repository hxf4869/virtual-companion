package com.virtualcompanion.runtime.export;

import com.virtualcompanion.platform.persistence.ExportService;
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
 * of deleting the object-storage file. A sweep failure is logged and the next
 * scheduled round still runs (same resilience shape as the other scheduled
 * maintenance jobs). The bean is registered by {@code AuthDataSourceConfig}
 * only while the auth datasource is enabled.
 */
public class ExportExpiryScheduler {

    private static final Logger log = LoggerFactory.getLogger(ExportExpiryScheduler.class);

    private final ExportService exportService;

    public ExportExpiryScheduler(ExportService exportService) {
        this.exportService = exportService;
    }

    /** One sweep. Runs on its own slow cadence — expiry is an hourly concern. */
    @Scheduled(fixedDelayString = "${virtual-companion.data-export.expiry-poll-delay-ms:60000}")
    public void sweepExpiredExports() {
        try {
            int expired = exportService.expireStale();
            if (expired > 0) {
                log.info("data-export expiry sweep purged {} expired export(s)", expired);
            }
        } catch (RuntimeException e) {
            log.error("data-export expiry sweep failed; will retry next run", e);
        }
    }
}
