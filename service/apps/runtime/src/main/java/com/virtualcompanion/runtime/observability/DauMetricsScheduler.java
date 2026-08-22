package com.virtualcompanion.runtime.observability;

import java.sql.Timestamp;
import java.time.Instant;
import com.virtualcompanion.runtime.servicemode.BetaServiceWindow;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * METRICS-ALERT (§22.10 / §26.6): refreshes the {@code vc_beta_dau} gauge
 * from the V77 job SD. The day boundary follows the beta service-window zone
 * — the same zone the DAU cap enforces — whether or not the gate itself is
 * enabled. A failed poll only logs an error: the gauge keeps its last value
 * until the next pass (scrape/health is the detection path for a dead poll,
 * not the alert webhook). The bean is registered by
 * {@code AuthDataSourceConfig} only while the auth datasource is live.
 */
public class DauMetricsScheduler {

    private static final Logger log = LoggerFactory.getLogger(DauMetricsScheduler.class);

    private final JdbcTemplate authJdbcTemplate;
    private final VcMetrics metrics;
    private final BetaServiceWindow serviceWindow;

    public DauMetricsScheduler(
            JdbcTemplate authJdbcTemplate, VcMetrics metrics, BetaServiceWindow serviceWindow) {
        this.authJdbcTemplate = authJdbcTemplate;
        this.metrics = metrics;
        this.serviceWindow = serviceWindow;
    }

    @Scheduled(fixedDelayString = "${virtual-companion.observability.dau-poll-ms:60000}")
    public void pollDailyActiveUsers() {
        Instant dayStart = serviceWindow.dayStart(Instant.now());
        try {
            Long dau = authJdbcTemplate.queryForObject(
                    "SELECT vc.job_daily_active_users(?)", Long.class, Timestamp.from(dayStart));
            metrics.dau(dau == null ? 0L : dau);
        } catch (RuntimeException e) {
            log.error("daily-active-user metric poll failed", e);
        }
    }
}
